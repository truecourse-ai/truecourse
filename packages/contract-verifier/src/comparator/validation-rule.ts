/**
 * ValidationRule comparator. Diffs a spec-side conditional
 * field-requiredness rule ("input <target> is required | optional | forbidden
 * WHEN <predicate over a setting/entity field>") against the
 * `ExtractedValidationRule` records the code-side extractor produced from the
 * read-setting → branch → require/throw guard shape.
 *
 * Adapter- and language-agnostic: both sides carry a typed
 * `ValidationRuleContract`, so the diff is structural and works the same
 * against TS/JS or Python guards.
 *
 * Matching strategy — name-independent, by STRUCTURE:
 *
 *   A spec rule matches a code rule when their targets agree (normalized,
 *   cross-convention) AND their `when` predicates constrain the same column
 *   (normalized). The author-chosen artifact identity is never used to match —
 *   `customer.downgrade-reason-required-when-gold` (spec) lines up with the
 *   code guard whose extracted identity is
 *   `customer.loyaltyTier.required-when.downgradeReason`.
 *
 * Drift kinds (`obligationKey` formats):
 *
 *   validation-rule.${identity}.not-enforced          high
 *     Spec requires the rule, but no code guard enforces this target under
 *     this condition. The code does NOT enforce the required-when rule the
 *     contract states — the headline drift this comparator catches.
 *
 *   validation-rule.${identity}.effect-mismatch       high
 *     A guard on the same target+condition exists, but enforces a different
 *     effect (spec `required`, code makes it `optional`/`forbidden`).
 *
 *   validation-rule.${identity}.condition-mismatch    high
 *     A guard on the same target+column exists, but the trigger VALUE differs
 *     (spec fires when the setting is `"gold"`, code fires on `"silver"`) —
 *     the rule is enforced, but for the wrong condition.
 */

import { randomUUID } from 'node:crypto';
import type {
  ArtifactRef,
  ContractDrift,
  LiteralValue,
  Predicate,
  Severity,
  SpecOrigin,
  ValidationRuleContract,
} from '../types/index.js';
import type { ExtractedValidationRule } from '../extractor/validation-rule/types.js';

export interface ValidationRuleCompareInput {
  ref: ArtifactRef;
  origin: SpecOrigin | null;
  contract: ValidationRuleContract;
  /** Every validation rule the code-side extractor found. The comparator does
   *  its own structural match — it is NOT pre-filtered by the orchestrator. */
  codeRules: ExtractedValidationRule[];
}

export function compareValidationRule(input: ValidationRuleCompareInput): ContractDrift[] {
  const { ref, contract, codeRules } = input;
  const specTarget = normalize(contract.target);
  const specCol = predicateColumn(contract.when);

  // Candidate code rules: same target + same constrained column. A `raw`/
  // columnless spec `when` matches on target alone (no column to compare).
  const candidates = codeRules.filter((r) => {
    if (normalize(r.contract.target) !== specTarget) return false;
    if (specCol === null) return true;
    return predicateColumn(r.contract.when) === specCol;
  });

  if (candidates.length === 0) {
    return [{
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: ref,
      obligationKey: `validation-rule.${ref.identity}.not-enforced`,
      severity: 'high' as Severity,
      filePath: ref.identity,
      lineStart: 0,
      lineEnd: 0,
      message:
        `Spec requires \`${contract.target}\` to be ${contract.effect} when ` +
        `\`${describePredicate(contract.when)}\`, but no code guard enforces this rule.`,
      specSide: describeRule(contract),
      codeSide: '<no enforcing guard found>',
    }];
  }

  // A guard exists. Effect mismatch and condition (trigger-value) mismatch are
  // independent drifts; emit at most one of each, citing the first candidate.
  const drifts: ContractDrift[] = [];

  const effectMatch = candidates.find((r) => r.contract.effect === contract.effect);
  if (!effectMatch) {
    const m = candidates[0];
    drifts.push({
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: ref,
      obligationKey: `validation-rule.${ref.identity}.effect-mismatch`,
      severity: 'high',
      filePath: m.source.filePath,
      lineStart: m.source.lineStart,
      lineEnd: m.source.lineEnd,
      message:
        `Spec asserts \`${contract.target}\` is ${contract.effect} under this condition, ` +
        `but the code guard enforces it as ${m.contract.effect}.`,
      specSide: `effect ${contract.effect}`,
      codeSide: `effect ${m.contract.effect}`,
    });
  }

  // Condition (trigger value) mismatch — only when the spec `when` carries a
  // comparable value and a same-effect guard exists whose value differs.
  if (specCol !== null && predicateHasValue(contract.when)) {
    const valueMatch = (effectMatch ? [effectMatch] : candidates).find((r) =>
      whenValuesEqual(contract.when, r.contract.when),
    );
    if (!valueMatch) {
      const m = effectMatch ?? candidates[0];
      drifts.push({
        id: randomUUID(),
        type: 'contract-drift',
        artifactRef: ref,
        obligationKey: `validation-rule.${ref.identity}.condition-mismatch`,
        severity: 'high',
        filePath: m.source.filePath,
        lineStart: m.source.lineStart,
        lineEnd: m.source.lineEnd,
        message:
          `Spec gates \`${contract.target}\` on \`${describePredicate(contract.when)}\`, ` +
          `but the code guard fires on \`${describePredicate(m.contract.when)}\`.`,
        specSide: describePredicate(contract.when),
        codeSide: describePredicate(m.contract.when),
      });
    }
  }

  return drifts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cross-convention field/column normalization (`loyalty_tier` ≡ `loyaltyTier`). */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The normalized constrained column of a `when` predicate, or null for a
 *  `raw` predicate (no comparable column). */
function predicateColumn(p: Predicate): string | null {
  if (p.kind === 'raw') return null;
  if (p.kind === 'column-compare') return normalize(p.left.column);
  return normalize(p.column.column);
}

function predicateHasValue(p: Predicate): boolean {
  switch (p.kind) {
    case 'is-null':
    case 'is-not-null':
    case 'raw':
      return false;
    default:
      return true;
  }
}

/** Trigger-value equality for two `when` predicates of the same shape. Differing
 *  predicate KINDS (`eq` vs `gt`) count as unequal — the condition changed. */
function whenValuesEqual(a: Predicate, b: Predicate): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'eq': case 'neq': case 'gt': case 'gte': case 'lt': case 'lte':
      return literalKey(a.value) === literalKey((b as typeof a).value);
    case 'in': case 'not-in': {
      const av = a.values, bv = (b as typeof a).values;
      if (av.length !== bv.length) return false;
      const aSet = new Set(av.map(literalKey));
      return bv.every((v) => aSet.has(literalKey(v)));
    }
    case 'between': {
      const bb = b as typeof a;
      return literalKey(a.low) === literalKey(bb.low) && literalKey(a.high) === literalKey(bb.high);
    }
    case 'like': case 'ilike':
      return a.pattern === (b as typeof a).pattern;
    case 'column-compare': {
      const bb = b as typeof a;
      return a.op === bb.op
        && normalize(a.left.column) === normalize(bb.left.column)
        && normalize(a.right.column) === normalize(bb.right.column);
    }
    case 'is-null': case 'is-not-null': case 'raw':
      return true;
  }
}

function literalKey(v: LiteralValue): string {
  switch (v.kind) {
    case 'string':     return `s:${v.value}`;
    case 'number':     return `n:${v.value}`;
    case 'boolean':    return `b:${v.value}`;
    case 'null':       return 'null';
    case 'identifier': return `id:${v.ref}`;
    case 'parameter':  return `p:${v.name ?? `#${v.index ?? '?'}`}`;
  }
}

function describeRule(c: ValidationRuleContract): string {
  const actor = c.actor ? ` (actor ${c.actor})` : '';
  return `${c.target} ${c.effect} when ${describePredicate(c.when)}${actor}`;
}

function qualifiedColumnText(c: { table?: string; column: string }): string {
  return c.table ? `${c.table}.${c.column}` : c.column;
}

function describePredicate(p: Predicate): string {
  switch (p.kind) {
    case 'is-null':     return `is-null ${qualifiedColumnText(p.column)}`;
    case 'is-not-null': return `is-not-null ${qualifiedColumnText(p.column)}`;
    case 'eq':  return `${qualifiedColumnText(p.column)} = ${literalText(p.value)}`;
    case 'neq': return `${qualifiedColumnText(p.column)} != ${literalText(p.value)}`;
    case 'gt':  return `${qualifiedColumnText(p.column)} > ${literalText(p.value)}`;
    case 'gte': return `${qualifiedColumnText(p.column)} >= ${literalText(p.value)}`;
    case 'lt':  return `${qualifiedColumnText(p.column)} < ${literalText(p.value)}`;
    case 'lte': return `${qualifiedColumnText(p.column)} <= ${literalText(p.value)}`;
    case 'in':     return `${qualifiedColumnText(p.column)} IN (${p.values.map(literalText).join(', ')})`;
    case 'not-in': return `${qualifiedColumnText(p.column)} NOT IN (${p.values.map(literalText).join(', ')})`;
    case 'between': return `${qualifiedColumnText(p.column)} BETWEEN ${literalText(p.low)} AND ${literalText(p.high)}`;
    case 'like':   return `${qualifiedColumnText(p.column)} LIKE '${p.pattern}'`;
    case 'ilike':  return `${qualifiedColumnText(p.column)} ILIKE '${p.pattern}'`;
    case 'column-compare': {
      const opText: Record<string, string> = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' };
      return `${qualifiedColumnText(p.left)} ${opText[p.op]} ${qualifiedColumnText(p.right)}`;
    }
    case 'raw':    return p.sql;
  }
}

function literalText(v: LiteralValue): string {
  switch (v.kind) {
    case 'string':     return `'${v.value}'`;
    case 'number':     return String(v.value);
    case 'boolean':    return v.value ? 'TRUE' : 'FALSE';
    case 'null':       return 'NULL';
    case 'identifier': return v.ref;
    case 'parameter':  return v.name ? `:${v.name}` : `?${v.index ?? ''}`;
  }
}
