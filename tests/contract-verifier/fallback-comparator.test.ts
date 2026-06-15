import { describe, it, expect } from 'vitest';
import { compareFallback } from '../../packages/contract-verifier/src/comparator/fallback.js';
import type {
  ArtifactRef,
  FallbackContract,
} from '../../packages/contract-verifier/src/types/index.js';
import type { ExtractedFallback } from '../../packages/contract-verifier/src/extractor/fallback/types.js';

const ref: ArtifactRef = {
  type: 'Fallback',
  identity: 'customer.loyalty-tier-default',
  quoted: false,
};

/** The spec fallback the IL fixtures author: a customer with no recorded
 *  loyalty tier is coalesced to the named default `DEFAULT_LOYALTY_TIER`. */
function specFallback(overrides: Partial<FallbackContract> = {}): FallbackContract {
  return {
    target: { field: 'loyaltyTier' },
    trigger: 'null-or-absent',
    defaultValue: { kind: 'identifier', ref: 'DEFAULT_LOYALTY_TIER' },
    ...overrides,
  };
}

function mkCode(overrides: Partial<ExtractedFallback>): ExtractedFallback {
  return {
    identity: 'loyaltyTier.fallback',
    contract: specFallback(),
    source: { filePath: '/code/customers.preferences.service.ts', lineStart: 30, lineEnd: 30 },
    ...overrides,
  };
}

describe('Fallback comparator', () => {
  it('no drift when a code site coalesces the same target+default (matches authored contract)', () => {
    const drifts = compareFallback({
      ref,
      origin: null,
      contract: specFallback(),
      codeFallbacks: [mkCode({})],
    });
    expect(drifts).toEqual([]);
  });

  it('matches by structure, not by author-chosen name (cross-convention target)', () => {
    // Spec uses snake_case; code uses camelCase. Same coalescing, different style.
    const drifts = compareFallback({
      ref,
      origin: null,
      contract: specFallback({ target: { field: 'loyalty_tier' } }),
      codeFallbacks: [mkCode({})], // camelCase code fallback
    });
    expect(drifts).toEqual([]);
  });

  it('matches an identifier default cross-convention (DEFAULT_TZ ≡ default_tz)', () => {
    const drifts = compareFallback({
      ref,
      origin: null,
      contract: specFallback({ defaultValue: { kind: 'identifier', ref: 'DEFAULT_LOYALTY_TIER' } }),
      codeFallbacks: [mkCode({ contract: specFallback({ defaultValue: { kind: 'identifier', ref: 'default_loyalty_tier' } }) })],
    });
    expect(drifts).toEqual([]);
  });

  it('fires not-applied when no code site coalesces this target', () => {
    const drifts = compareFallback({
      ref,
      origin: null,
      contract: specFallback(),
      codeFallbacks: [], // code dropped the coalescing
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('fallback.customer.loyalty-tier-default.not-applied');
    expect(drifts[0].severity).toBe('high');
    expect(drifts[0].codeSide).toBe('<no coalescing site found>');
  });

  it('fires not-applied when a coalescing exists only on a different target', () => {
    const drifts = compareFallback({
      ref,
      origin: null,
      contract: specFallback(),
      codeFallbacks: [mkCode({ contract: specFallback({ target: { field: 'someOtherField' } }) })],
    });
    expect(drifts.map((d) => d.obligationKey)).toEqual([
      'fallback.customer.loyalty-tier-default.not-applied',
    ]);
  });

  it('fires default-mismatch when the code coalesces to a different default value', () => {
    // Spec: default to DEFAULT_LOYALTY_TIER. Code: a flipped literal default.
    const drifts = compareFallback({
      ref,
      origin: null,
      contract: specFallback({ defaultValue: { kind: 'string', value: 'free' } }),
      codeFallbacks: [mkCode({ contract: specFallback({ defaultValue: { kind: 'string', value: 'paid' } }) })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('fallback.customer.loyalty-tier-default.default-mismatch');
    expect(drifts[0].severity).toBe('high');
    expect(drifts[0].specSide).toBe('"free"');
    expect(drifts[0].codeSide).toBe('"paid"');
  });

  it('fires default-mismatch when the named-constant default differs', () => {
    const drifts = compareFallback({
      ref,
      origin: null,
      contract: specFallback({ defaultValue: { kind: 'identifier', ref: 'DEFAULT_LOYALTY_TIER' } }),
      codeFallbacks: [mkCode({ contract: specFallback({ defaultValue: { kind: 'identifier', ref: 'PREMIUM_TIER' } }) })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('fallback.customer.loyalty-tier-default.default-mismatch');
  });

  it('fires trigger-mismatch when the value matches but the trigger differs', () => {
    // Same default, but spec gates on null-or-absent while code only on absent.
    const drifts = compareFallback({
      ref,
      origin: null,
      contract: specFallback({ trigger: 'null-or-absent' }),
      codeFallbacks: [mkCode({ contract: specFallback({ trigger: 'absent' }) })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('fallback.customer.loyalty-tier-default.trigger-mismatch');
    expect(drifts[0].severity).toBe('medium');
    expect(drifts[0].specSide).toBe('trigger null-or-absent');
    expect(drifts[0].codeSide).toBe('trigger absent');
  });

  it('does not fire trigger-mismatch when the default already mismatched', () => {
    // A default-mismatch is the headline drift; we do not also emit a
    // trigger-mismatch off a candidate whose value never matched.
    const drifts = compareFallback({
      ref,
      origin: null,
      contract: specFallback({ trigger: 'null-or-absent', defaultValue: { kind: 'string', value: 'free' } }),
      codeFallbacks: [mkCode({ contract: specFallback({ trigger: 'absent', defaultValue: { kind: 'string', value: 'paid' } }) })],
    });
    expect(drifts.map((d) => d.obligationKey)).toEqual([
      'fallback.customer.loyalty-tier-default.default-mismatch',
    ]);
  });
});
