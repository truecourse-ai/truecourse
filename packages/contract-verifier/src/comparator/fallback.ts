/**
 * Fallback comparator. Diffs a spec-side null/absent → default RUNTIME
 * coalescing rule ("when <target> is null/absent, fall back to
 * <default-value>") against the `ExtractedFallback` records the code-side
 * extractor produced from the coalescing shapes (`x ?? D`, `x or D`,
 * `(x = D)`, `if (x == null) x = D`).
 *
 * Adapter- and language-agnostic: both sides carry a typed
 * `FallbackContract`, so the diff is structural and works the same against a
 * TS `??`, a Python `or`, or a guarded assignment.
 *
 * Matching strategy — name-independent, by STRUCTURE:
 *
 *   A spec fallback matches a code fallback when their targets agree
 *   (normalized field, cross-convention `loyalty_tier` ≡ `loyaltyTier`). The
 *   author-chosen artifact identity is never used to match —
 *   `customer.loyalty-tier-default` (spec) lines up with the code coalescing
 *   whose extracted identity is `loyaltyTier.fallback`.
 *
 * Drift kinds (`obligationKey` formats):
 *
 *   fallback.${identity}.not-applied        high
 *     Spec states the coalescing, but no code site falls back for this
 *     target. The code does NOT supply the null/absent → default the
 *     contract states — the headline drift this comparator catches.
 *
 *   fallback.${identity}.default-mismatch    high
 *     A coalescing on the same target exists, but substitutes a different
 *     default value (spec `"USD"`, code `"EUR"`; or a different named
 *     constant) — the fallback fires, but to the wrong value. This is the
 *     "fallback flipped from FREE to PAID" silent behaviour change.
 *
 *   fallback.${identity}.trigger-mismatch    medium
 *     A coalescing on the same target+default exists, but fires on a
 *     narrower/wider trigger (spec `null-or-absent`, code only `absent`) —
 *     the value matches but the condition that invokes it differs.
 */

import { randomUUID } from 'node:crypto';
import type {
  ArtifactRef,
  ContractDrift,
  FallbackContract,
  LiteralValue,
  Severity,
  SpecOrigin,
} from '../types/index.js';
import type { ExtractedFallback } from '../extractor/fallback/types.js';

export interface FallbackCompareInput {
  ref: ArtifactRef;
  origin: SpecOrigin | null;
  contract: FallbackContract;
  /** Every fallback the code-side extractor found. The comparator does its own
   *  structural match — it is NOT pre-filtered by the orchestrator. */
  codeFallbacks: ExtractedFallback[];
}

export function compareFallback(input: FallbackCompareInput): ContractDrift[] {
  const { ref, contract, codeFallbacks } = input;
  const specTarget = normalize(contract.target.field);

  // Candidate code fallbacks: same target field (normalized, cross-convention).
  const candidates = codeFallbacks.filter(
    (f) => normalize(f.contract.target.field) === specTarget,
  );

  if (candidates.length === 0) {
    return [{
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: ref,
      obligationKey: `fallback.${ref.identity}.not-applied`,
      severity: 'high' as Severity,
      filePath: ref.identity,
      lineStart: 0,
      lineEnd: 0,
      message:
        `Spec states \`${contract.target.field}\` falls back to ` +
        `${describeLiteral(contract.defaultValue)} when ${contract.trigger}, ` +
        `but no code site coalesces this target.`,
      specSide: describeFallback(contract),
      codeSide: '<no coalescing site found>',
    }];
  }

  // A coalescing exists. Default-value mismatch and trigger mismatch are
  // independent drifts; emit at most one of each, citing the first candidate.
  const drifts: ContractDrift[] = [];

  const valueMatch = candidates.find((f) =>
    literalKey(f.contract.defaultValue) === literalKey(contract.defaultValue),
  );
  if (!valueMatch) {
    const m = candidates[0];
    drifts.push({
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: ref,
      obligationKey: `fallback.${ref.identity}.default-mismatch`,
      severity: 'high',
      filePath: m.source.filePath,
      lineStart: m.source.lineStart,
      lineEnd: m.source.lineEnd,
      message:
        `Spec asserts \`${contract.target.field}\` falls back to ` +
        `${describeLiteral(contract.defaultValue)}, but the code coalesces to ` +
        `${describeLiteral(m.contract.defaultValue)}.`,
      specSide: describeLiteral(contract.defaultValue),
      codeSide: describeLiteral(m.contract.defaultValue),
    });
  }

  // Trigger mismatch — only when a same-default coalescing exists whose trigger
  // differs (the value is right, but the condition invoking it changed).
  const triggerMatch = (valueMatch ? [valueMatch] : candidates).find(
    (f) => f.contract.trigger === contract.trigger,
  );
  if (valueMatch && !triggerMatch) {
    const m = valueMatch;
    drifts.push({
      id: randomUUID(),
      type: 'contract-drift',
      artifactRef: ref,
      obligationKey: `fallback.${ref.identity}.trigger-mismatch`,
      severity: 'medium',
      filePath: m.source.filePath,
      lineStart: m.source.lineStart,
      lineEnd: m.source.lineEnd,
      message:
        `Spec gates the \`${contract.target.field}\` fallback on \`${contract.trigger}\`, ` +
        `but the code coalesces on \`${m.contract.trigger}\`.`,
      specSide: `trigger ${contract.trigger}`,
      codeSide: `trigger ${m.contract.trigger}`,
    });
  }

  return drifts;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cross-convention field normalization (`loyalty_tier` ≡ `loyaltyTier`). */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Structural equality key for a default literal. Identifier defaults compare
 *  by referenced name (normalized) so `DEFAULT_TZ` ≡ `default_tz`. */
function literalKey(v: LiteralValue): string {
  switch (v.kind) {
    case 'string':     return `s:${v.value}`;
    case 'number':     return `n:${v.value}`;
    case 'boolean':    return `b:${v.value}`;
    case 'null':       return 'null';
    case 'identifier': return `id:${normalize(v.ref)}`;
    case 'parameter':  return `p:${v.name ?? `#${v.index ?? '?'}`}`;
  }
}

function describeFallback(c: FallbackContract): string {
  return `${c.target.field} ?? ${describeLiteral(c.defaultValue)} (when ${c.trigger})`;
}

function describeLiteral(v: LiteralValue): string {
  switch (v.kind) {
    case 'string':     return `"${v.value}"`;
    case 'number':     return String(v.value);
    case 'boolean':    return String(v.value);
    case 'null':       return 'null';
    case 'identifier': return v.ref;
    case 'parameter':  return v.name ? `:${v.name}` : `?${v.index ?? ''}`;
  }
}
