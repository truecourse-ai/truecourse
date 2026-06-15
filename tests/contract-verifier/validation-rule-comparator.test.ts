import { describe, it, expect } from 'vitest';
import { compareValidationRule } from '../../packages/contract-verifier/src/comparator/validation-rule.js';
import type {
  ArtifactRef,
  ValidationRuleContract,
} from '../../packages/contract-verifier/src/types/index.js';
import type { ExtractedValidationRule } from '../../packages/contract-verifier/src/extractor/validation-rule/types.js';

const ref: ArtifactRef = {
  type: 'ValidationRule',
  identity: 'customer.downgrade-reason-required-when-gold',
  quoted: false,
};

/** The spec rule the IL fixtures author: a gold customer downgrading must
 *  supply a reason. */
function specRule(overrides: Partial<ValidationRuleContract> = {}): ValidationRuleContract {
  return {
    target: 'downgradeReason',
    when: { kind: 'eq', column: { table: 'customer', column: 'loyaltyTier' }, value: { kind: 'string', value: 'gold' } },
    actor: 'customer',
    effect: 'required',
    onViolation: { status: 400, errorCode: 'downgrade_reason_required' },
    ...overrides,
  };
}

function mkCode(overrides: Partial<ExtractedValidationRule>): ExtractedValidationRule {
  return {
    identity: 'customer.loyaltyTier.required-when.downgradeReason',
    contract: specRule(),
    source: { filePath: '/code/customers.preferences.service.ts', lineStart: 75, lineEnd: 84 },
    ...overrides,
  };
}

describe('ValidationRule comparator', () => {
  it('no drift when a code guard enforces the same rule (matches authored contract)', () => {
    const drifts = compareValidationRule({
      ref,
      origin: null,
      contract: specRule(),
      codeRules: [mkCode({})],
    });
    expect(drifts).toEqual([]);
  });

  it('matches by structure, not by author-chosen name (cross-convention target/column)', () => {
    // Spec uses snake_case; code uses camelCase. Same rule, different style.
    const drifts = compareValidationRule({
      ref,
      origin: null,
      contract: specRule({
        target: 'downgrade_reason',
        when: { kind: 'eq', column: { table: 'customer', column: 'loyalty_tier' }, value: { kind: 'string', value: 'gold' } },
      }),
      codeRules: [mkCode({})], // camelCase code rule
    });
    expect(drifts).toEqual([]);
  });

  it('fires not-enforced when no code guard enforces the target+condition', () => {
    const drifts = compareValidationRule({
      ref,
      origin: null,
      contract: specRule(),
      codeRules: [], // code dropped the guard
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe(
      'validation-rule.customer.downgrade-reason-required-when-gold.not-enforced',
    );
    expect(drifts[0].severity).toBe('high');
    expect(drifts[0].codeSide).toBe('<no enforcing guard found>');
  });

  it('fires not-enforced when a guard exists on a different target', () => {
    const drifts = compareValidationRule({
      ref,
      origin: null,
      contract: specRule(),
      codeRules: [mkCode({ contract: specRule({ target: 'someOtherField' }) })],
    });
    expect(drifts.map((d) => d.obligationKey)).toEqual([
      'validation-rule.customer.downgrade-reason-required-when-gold.not-enforced',
    ]);
  });

  it('fires effect-mismatch when the guard enforces a different effect', () => {
    const drifts = compareValidationRule({
      ref,
      origin: null,
      contract: specRule({ effect: 'required' }),
      codeRules: [mkCode({ contract: specRule({ effect: 'forbidden' }) })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe(
      'validation-rule.customer.downgrade-reason-required-when-gold.effect-mismatch',
    );
    expect(drifts[0].specSide).toBe('effect required');
    expect(drifts[0].codeSide).toBe('effect forbidden');
  });

  it('fires condition-mismatch when the guard fires on a different trigger value', () => {
    // Spec: reason required when tier is `gold`. Code: fires on `silver`.
    const drifts = compareValidationRule({
      ref,
      origin: null,
      contract: specRule(),
      codeRules: [mkCode({
        contract: specRule({
          when: { kind: 'eq', column: { table: 'customer', column: 'loyaltyTier' }, value: { kind: 'string', value: 'silver' } },
        }),
      })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe(
      'validation-rule.customer.downgrade-reason-required-when-gold.condition-mismatch',
    );
    expect(drifts[0].specSide).toContain("'gold'");
    expect(drifts[0].codeSide).toContain("'silver'");
  });

  it('emits both effect and condition mismatch independently', () => {
    const drifts = compareValidationRule({
      ref,
      origin: null,
      contract: specRule({ effect: 'required' }),
      codeRules: [mkCode({
        contract: specRule({
          effect: 'optional',
          when: { kind: 'eq', column: { table: 'customer', column: 'loyaltyTier' }, value: { kind: 'string', value: 'silver' } },
        }),
      })],
    });
    expect(drifts.map((d) => d.obligationKey).sort()).toEqual([
      'validation-rule.customer.downgrade-reason-required-when-gold.condition-mismatch',
      'validation-rule.customer.downgrade-reason-required-when-gold.effect-mismatch',
    ]);
  });

  it('no condition-mismatch for a nullary (valueless) when predicate', () => {
    const isNull: ValidationRuleContract = specRule({
      when: { kind: 'is-null', column: { table: 'customer', column: 'loyaltyTier' } },
    });
    const drifts = compareValidationRule({
      ref,
      origin: null,
      contract: isNull,
      codeRules: [mkCode({ contract: isNull })],
    });
    expect(drifts).toEqual([]);
  });
});
