/**
 * Structural diff between two contract corpora.
 *
 * Both sides are parsed + resolved through the verifier, producing typed
 * contracts in identical shapes. This module then walks the resolution
 * indices and produces:
 *
 *   - artifact-level differences  (one side has an artifact the other
 *                                  doesn't, by `${kind}:${identity}`)
 *   - obligation-level differences (same artifact identity, but the
 *                                   obligations they encode differ)
 *
 * "Obligations" are derived per artifact kind — the same keys the
 * verifier's comparators use when emitting drifts. So if two corpora
 * produce the same set of obligation keys, they're behaviorally
 * equivalent: the verifier will catch the same bugs from either.
 *
 * The diff is intentionally NOT a text diff. Identical encodings with
 * different whitespace, ordering, or section labels report no
 * differences here — that's the whole point.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parserOhm, resolver, types } from '@truecourse/contract-verifier';
import type { ArtifactRef } from '@truecourse/contract-verifier';
type AuthRequirementContract = types.AuthRequirementContract;
type AuthorizationRuleContract = types.AuthorizationRuleContract;
type EffectGroupContract = types.EffectGroupContract;
type EntityContract = types.EntityContract;
type ErrorEnvelopeContract = types.ErrorEnvelopeContract;
type FormulaContract = types.FormulaContract;
type IdempotencyContractC = types.IdempotencyContractC;
type OperationContract = types.OperationContract;
type PaginationContractC = types.PaginationContractC;
type StateMachineContract = types.StateMachineContract;

/**
 * One artifact-level difference: present on one side, absent on the other.
 */
export interface ArtifactDiff {
  ref: ArtifactRef;
  side: 'missing-on-left' | 'missing-on-right';
}

/**
 * One obligation-level difference: same artifact present on both sides,
 * but the obligation set differs. `missing` are obligations the LEFT
 * declares that the right doesn't; `extra` are obligations the right
 * declares that left doesn't.
 */
export interface ObligationDiff {
  ref: ArtifactRef;
  /** Obligations the LEFT contract declares that the right does not. */
  missing: string[];
  /** Obligations the RIGHT contract declares that the left does not. */
  extra: string[];
}

export interface CorpusDiff {
  /** Artifacts on the left that aren't on the right (or vice-versa). */
  artifactDiffs: ArtifactDiff[];
  /** Per-artifact obligation differences (same identity, different content). */
  obligationDiffs: ObligationDiff[];
  /** Total obligations the left side declares (denominator for coverage). */
  leftObligationCount: number;
  /**
   * Fraction of left-side obligations the right side also declares.
   * 1.0 = the right covers every obligation the left declared.
   */
  obligationCoverage: number;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Diff two `.truecourse/contracts/` directories. The conventional usage:
 * left = ground truth (hand-written), right = candidate (LLM-generated).
 */
export function diffContractDirs(leftDir: string, rightDir: string): CorpusDiff {
  return diffCorpora(loadCorpus(leftDir), loadCorpus(rightDir));
}

/** Diff two already-loaded corpora. Useful for tests with synthesized inputs. */
export function diffCorpora(
  left: Map<string, resolver.ResolvedArtifact>,
  right: Map<string, resolver.ResolvedArtifact>,
): CorpusDiff {
  const artifactDiffs: ArtifactDiff[] = [];
  const obligationDiffs: ObligationDiff[] = [];
  let leftObligationTotal = 0;
  let leftObligationMatched = 0;

  // Walk the union of keys so the diff is symmetric.
  const allKeys = new Set<string>([...left.keys(), ...right.keys()]);
  for (const key of allKeys) {
    const lhs = left.get(key);
    const rhs = right.get(key);

    if (lhs && !rhs) {
      artifactDiffs.push({ ref: lhs.ref, side: 'missing-on-right' });
      const obs = obligationsOf(lhs);
      leftObligationTotal += obs.length;
      continue;
    }
    if (rhs && !lhs) {
      artifactDiffs.push({ ref: rhs.ref, side: 'missing-on-left' });
      continue;
    }
    if (!lhs || !rhs) continue;

    // Same identity on both sides — diff obligations.
    const lhsObs = new Set(obligationsOf(lhs));
    const rhsObs = new Set(obligationsOf(rhs));
    leftObligationTotal += lhsObs.size;
    for (const o of lhsObs) if (rhsObs.has(o)) leftObligationMatched++;

    const missing = [...lhsObs].filter((o) => !rhsObs.has(o));
    const extra = [...rhsObs].filter((o) => !lhsObs.has(o));
    if (missing.length > 0 || extra.length > 0) {
      obligationDiffs.push({ ref: lhs.ref, missing, extra });
    }
  }

  const obligationCoverage =
    leftObligationTotal === 0 ? 1 : leftObligationMatched / leftObligationTotal;

  return {
    artifactDiffs,
    obligationDiffs,
    leftObligationCount: leftObligationTotal,
    obligationCoverage,
  };
}

// ---------------------------------------------------------------------------
// Corpus loader
// ---------------------------------------------------------------------------

export function loadCorpus(contractsDir: string): Map<string, resolver.ResolvedArtifact> {
  const files: ReturnType<typeof parserOhm.parseTcFile>[] = [];
  const visit = (dir: string): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.tc')) {
        files.push(parserOhm.parseTcFile(full, fs.readFileSync(full, 'utf-8')));
      }
    }
  };
  visit(contractsDir);
  return resolver.resolve(files).index;
}

// ---------------------------------------------------------------------------
// Per-kind obligation extraction.
//
// "Obligations" are the user-meaningful claims an artifact makes — the
// same units the verifier's comparators key drift entries on. Two
// artifacts with identical obligation sets behave identically when the
// verifier runs over them, regardless of how the .tc text differs.
// ---------------------------------------------------------------------------

function obligationsOf(a: resolver.ResolvedArtifact): string[] {
  if (!a.contract) return [];
  switch (a.ref.type) {
    case 'Operation':
      return operationObligations(a.contract as OperationContract);
    case 'Entity':
      return entityObligations(a.contract as EntityContract);
    case 'StateMachine':
      return stateMachineObligations(a.contract as StateMachineContract);
    case 'AuthRequirement':
      return authRequirementObligations(a.contract as AuthRequirementContract);
    case 'AuthorizationRule':
      return authorizationRuleObligations(a.contract as AuthorizationRuleContract);
    case 'ErrorEnvelope':
      return errorEnvelopeObligations(a.contract as ErrorEnvelopeContract);
    case 'PaginationContract':
      return paginationObligations(a.contract as PaginationContractC);
    case 'IdempotencyContract':
      return idempotencyObligations(a.contract as IdempotencyContractC);
    case 'EffectGroup':
      return effectGroupObligations(a.contract as EffectGroupContract);
    case 'Formula':
      return formulaObligations(a.contract as FormulaContract);
    default:
      return [];
  }
}

function operationObligations(c: OperationContract): string[] {
  const obs: string[] = [];
  obs.push(`method:${c.method}`);
  obs.push(`path:${c.path}`);
  for (const t of c.tags ?? []) obs.push(`tag:${t}`);
  for (const r of c.responses) {
    obs.push(`response.${r.status}`);
    if (r.condition?.kind) obs.push(`response.${r.status}.condition.${r.condition.kind}`);
    if (r.body?.envelopeRef) obs.push(`response.${r.status}.body.envelope`);
    if (r.body?.ref) obs.push(`response.${r.status}.body.ref:${r.body.ref.type}`);
    if (r.body?.errorCode) obs.push(`response.${r.status}.body.error-code:${r.body.errorCode}`);
    for (const h of r.headers ?? []) {
      if (h.required) obs.push(`response.${r.status}.headers.${h.name.toLowerCase()}.required`);
    }
    for (const e of r.effects ?? []) {
      obs.push(`response.${r.status}.effect.${e.kind}:${e.ref.type}:${e.ref.identity}`);
    }
    for (const f of r.forbids ?? []) {
      const w = f.when ? `when=${f.when}` : '';
      obs.push(`response.${r.status}.forbid.${f.kind}.${f.value ?? ''}${w}`);
    }
    if (r.inheritedFrom) {
      obs.push(`response.${r.status}.inherits:${r.inheritedFrom.type}:${r.inheritedFrom.identity}`);
    }
  }
  return obs;
}

function entityObligations(c: EntityContract): string[] {
  const obs: string[] = [];
  for (const name of Object.keys(c.fields)) {
    const f = c.fields[name];
    obs.push(`field:${name}`);
    if (f.mutability) obs.push(`field:${name}.mutability:${f.mutability}`);
    if (f.normalize) obs.push(`field:${name}.normalize:${f.normalize}`);
    if (f.references) obs.push(`field:${name}.references:${f.references.type}:${f.references.identity}`);
    if (f.boundTo) obs.push(`field:${name}.bound-to:${f.boundTo.type}:${f.boundTo.identity}`);
  }
  return obs;
}

function stateMachineObligations(c: StateMachineContract): string[] {
  const obs: string[] = [];
  for (const s of c.initial) obs.push(`initial:${s}`);
  for (const s of c.terminal) obs.push(`terminal:${s}`);
  for (const t of c.transitions) obs.push(`transition:${t.from}->${t.to}`);
  return obs;
}

function authRequirementObligations(c: AuthRequirementContract): string[] {
  const obs: string[] = [`scheme:${c.scheme}`];
  if (c.requiredRole) obs.push(`required-role:${c.requiredRole}`);
  obs.push(`selector:${selectorKey(c.selector)}`);
  return obs;
}

function authorizationRuleObligations(c: AuthorizationRuleContract): string[] {
  const obs: string[] = [];
  for (const op of c.appliesTo.operations) obs.push(`applies-to:${op.identity}`);
  if (c.except?.role) obs.push(`except-role:${c.except.role}`);
  // We deliberately don't include the predicate text — too sensitive to
  // wording. The fact that there IS a predicate is what matters here.
  if (c.predicate && c.predicate.length > 0) obs.push(`has-predicate`);
  return obs;
}

function errorEnvelopeObligations(c: ErrorEnvelopeContract): string[] {
  const obs: string[] = [];
  for (const cls of c.appliesTo.statusClass) obs.push(`status-class:${cls}`);
  for (const code of c.knownCodes) obs.push(`known-code:${code}`);
  return obs;
}

function paginationObligations(c: PaginationContractC): string[] {
  const obs: string[] = [`scheme:${c.scheme}`];
  for (const p of c.query) obs.push(`query:${p.name}${p.max !== undefined ? `:max=${p.max}` : ''}`);
  for (const f of c.forbids) obs.push(`forbid.${f.kind}.${f.value ?? ''}`);
  obs.push(`selector:${selectorKey(c.selector)}`);
  return obs;
}

function idempotencyObligations(c: IdempotencyContractC): string[] {
  return [
    `request-header:${c.requestHeader.toLowerCase()}`,
    `semantics:${c.semantics}`,
    `selector:${selectorKey(c.selector)}`,
  ];
}

function effectGroupObligations(c: EffectGroupContract): string[] {
  const obs: string[] = [];
  for (const e of c.effects) {
    obs.push(`effect:${e.identity}`);
    obs.push(`effect:${e.identity}.emit-when:${e.emitWhen.operationRef.identity}@${e.emitWhen.onStatus}`);
  }
  return obs;
}

function formulaObligations(c: FormulaContract): string[] {
  const obs: string[] = [`output:${c.output.field}`];
  for (const i of c.inputs) obs.push(`input:${i.field}`);
  // Don't compare expression text directly — same logic can be expressed
  // many ways. Just record the form.
  obs.push(`expression-kind:${c.expression.kind}`);
  return obs;
}

function selectorKey(s: types.SelectorExpr | undefined): string {
  if (!s) return 'none';
  switch (s.kind) {
    case 'path-glob': return `path-glob:${s.pattern}`;
    case 'path-regex': return `path-regex:${s.pattern}`;
    case 'method': return `method:${s.method}`;
    case 'tag': return `tag:${s.tag}`;
    case 'operations': return `operations:${s.ops.length}`;
    case 'all-of': return `all-of:${s.children.length}`;
    case 'any-of': return `any-of:${s.children.length}`;
    case 'none-of': return `none-of:${s.children.length}`;
    case 'not': return 'not';
    default: return 'unknown';
  }
}

// ---------------------------------------------------------------------------
// Pretty-printer for CLI output / test-failure context
// ---------------------------------------------------------------------------

export function formatCorpusDiff(diff: CorpusDiff): string {
  const lines: string[] = [];
  lines.push(
    `obligation coverage: ${(diff.obligationCoverage * 100).toFixed(1)}% ` +
      `(${Math.round(diff.obligationCoverage * diff.leftObligationCount)}/${diff.leftObligationCount})`,
  );
  if (diff.artifactDiffs.length > 0) {
    lines.push('');
    lines.push('Artifact-level differences:');
    for (const d of diff.artifactDiffs) {
      const tag = d.side === 'missing-on-right' ? 'only on left' : 'only on right';
      lines.push(`  ${d.ref.type}:${d.ref.identity}    (${tag})`);
    }
  }
  if (diff.obligationDiffs.length > 0) {
    lines.push('');
    lines.push('Obligation-level differences:');
    for (const d of diff.obligationDiffs) {
      lines.push(`  ${d.ref.type}:${d.ref.identity}`);
      for (const m of d.missing) lines.push(`    -  missing on right: ${m}`);
      for (const e of d.extra) lines.push(`    +  extra on right:   ${e}`);
    }
  }
  return lines.join('\n');
}
