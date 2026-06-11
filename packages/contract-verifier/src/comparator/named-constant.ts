/**
 * NamedConstant comparator. Matches spec-side `constant <name>`
 * artifacts to code-side `ExtractedConstant` records by identifier
 * name (case-normalized) and diffs the values.
 *
 * Drift kinds:
 *   constant.${name}.value-mismatch       high (auto-elevated to critical for
 *                                              model-identifier / tier-weight constants)
 *   constant.${name}.no-code-counterpart  info (coverage-gap surface)
 *
 * Name normalization: drop non-alphanumerics, lowercase. So
 * `TIER_WEIGHTS` ↔ `tierWeights` ↔ `tier-weights` ↔ `tier weights` all match.
 *
 * Value comparison is deep equality. For objects: every key present in
 * spec must match in code; extra code-side keys are tolerated (a code
 * dict can carry additional keys the spec doesn't constrain). Strict
 * dict equality is a flag the comparator could offer later.
 */

import { randomUUID } from 'node:crypto';
import type {
  ArtifactRef,
  ContractDrift,
  NamedConstantContract,
  Severity,
  SpecOrigin,
} from '../types/index.js';
import type { ExtractedConstant } from '../extractor/constant/types.js';

export interface NamedConstantCompareInput {
  ref: ArtifactRef;
  origin: SpecOrigin | null;
  contract: NamedConstantContract;
  codeConstants: ExtractedConstant[];
}

export function compareNamedConstant(input: NamedConstantCompareInput): ContractDrift[] {
  const { ref, contract, codeConstants } = input;
  const target = normalizeName(ref.identity);
  let matches = codeConstants.filter((c) => normalizeName(c.name) === target);

  // For namespaced spec identities (e.g. "auth.type.kubernetes"), fall back to
  // matching the last segment ("kubernetes") against window-global constants
  // and flat const-literal constants. This covers browser globals (window.X)
  // and Python/TS flat SCREAMING_SNAKE names paired with hierarchical spec
  // identities (e.g. KUBERNETES = "kubernetes" ↔ auth.type.kubernetes).
  //
  // For const-literal shapes the match also requires value equality when the
  // spec carries an expectedValue — this avoids spurious value-mismatch drifts
  // from unrelated constants that happen to share a last-segment name.
  if (matches.length === 0 && ref.identity.includes('.')) {
    const lastPart = ref.identity.split('.').pop()!;
    const lastTarget = normalizeName(lastPart);
    matches = codeConstants.filter((c) => {
      if (normalizeName(c.name) !== lastTarget) return false;
      if (c.shape === 'window-global') return true;
      if (c.shape === 'const-literal') {
        return (
          contract.expectedValue === undefined ||
          deepEqual(contract.expectedValue, c.value, /*allowExtraCodeKeys*/ true)
        );
      }
      return false;
    });
  }

  // Settings-field suffix match. A Pydantic settings field is emitted under its
  // env scope WITHOUT the project prefix (`SERVER_ANALYTICS_ENABLED`), while the
  // spec names it with the prefix (`PREFECT_SERVER_ANALYTICS_ENABLED`). Bind them
  // when the spec name ENDS WITH the code name and the values are equal. The
  // value gate + the suffix being multi-segment (the code name still carries the
  // scope, e.g. `serveranalyticsenabled`) keeps this from matching unrelated
  // single-word constants. Scoped to `settings-field` shape only — no effect on
  // any other constant kind or campaign.
  if (matches.length === 0) {
    matches = codeConstants.filter((c) => {
      if (c.shape !== 'settings-field') return false;
      const codeName = normalizeName(c.name);
      if (codeName.length < 8 || !target.endsWith(codeName)) return false;
      return (
        contract.expectedValue === undefined ||
        deepEqual(contract.expectedValue, c.value, /*allowExtraCodeKeys*/ true)
      );
    });
  }

  if (matches.length === 0) {
    return [{
      id: randomUUID(),
      type: 'contract-drift' as const,
      artifactRef: ref,
      obligationKey: `constant.${ref.identity}.no-code-counterpart`,
      severity: 'info' as Severity,
      filePath: ref.identity,
      lineStart: 0,
      lineEnd: 0,
      message: `Spec declares constant \`${ref.identity}\` but no code-side constant matches by name.`,
      specSide: `expected: ${formatValue(contract.expectedValue)}`,
      codeSide: '<no match>',
    }];
  }

  // A contract without an explicit expected-value (undefined) only asserts
  // presence; skip value comparison entirely.
  if (contract.expectedValue === undefined) {
    return [];
  }

  const drifts: ContractDrift[] = [];
  for (const m of matches) {
    if (deepEqual(contract.expectedValue, m.value, /*allowExtraCodeKeys*/ true)) continue;
    drifts.push({
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: ref,
      obligationKey: `constant.${ref.identity}.value-mismatch`,
      severity: severityFor(ref.identity, contract),
      filePath: m.source.filePath,
      lineStart: m.source.lineStart,
      lineEnd: m.source.lineEnd,
      message: `Spec asserts \`${ref.identity} = ${formatValue(contract.expectedValue)}\` but code has \`${formatValue(m.value)}\`.`,
      specSide: formatValue(contract.expectedValue),
      codeSide: formatValue(m.value),
    });
  }
  return drifts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  return s.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

function severityFor(name: string, _contract: NamedConstantContract): Severity {
  // Conservative escalation: certain identifier patterns are
  // high-blast-radius drifts. Keep this small; over-escalation
  // creates false-criticality.
  if (/MODEL|TIER_?WEIGHTS?|API_?KEY|SECRET/i.test(name)) return 'critical';
  return 'high';
}

function deepEqual(a: unknown, b: unknown, allowExtraCodeKeys: boolean): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i], allowExtraCodeKeys)) return false;
    }
    return true;
  }
  // Object — compare key-by-key. Spec keys must all be present and
  // match; if `allowExtraCodeKeys`, code-side may have additional keys.
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  for (const k of Object.keys(aRec)) {
    if (!(k in bRec)) return false;
    if (!deepEqual(aRec[k], bRec[k], allowExtraCodeKeys)) return false;
  }
  if (!allowExtraCodeKeys) {
    for (const k of Object.keys(bRec)) {
      if (!(k in aRec)) return false;
    }
  }
  return true;
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return `"${v}"`;
  if (v === null) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
