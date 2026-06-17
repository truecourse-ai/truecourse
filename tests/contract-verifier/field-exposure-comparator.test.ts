import { describe, it, expect } from 'vitest';
import { compareFieldExposure } from '../../packages/contract-verifier/src/comparator/field-exposure.js';
import type {
  ArtifactRef,
  FieldExposureContract,
} from '../../packages/contract-verifier/src/types/index.js';
import type { ExtractedFieldExposure } from '../../packages/contract-verifier/src/extractor/field-exposure/types.js';

const ref: ArtifactRef = {
  type: 'FieldExposure',
  identity: 'customer.loyalty-tier-exposed',
  quoted: false,
};

/** The spec exposure the IL fixtures author: a customer's loyalty tier must
 *  travel on the public-profile read path via BOTH channels. */
function specExposure(overrides: Partial<FieldExposureContract> = {}): FieldExposureContract {
  return {
    target: { entity: { type: 'Entity', identity: 'Customer', quoted: false }, field: 'loyaltyTier' },
    exposedVia: ['query-select', 'api-response'],
    ...overrides,
  };
}

function mkCode(overrides: Partial<ExtractedFieldExposure> = {}): ExtractedFieldExposure {
  return {
    identity: 'loyaltyTier.exposure',
    contract: { target: { field: 'loyaltyTier' }, exposedVia: ['query-select', 'api-response'] },
    source: { filePath: '/code/customers.profile.service.ts', lineStart: 38, lineEnd: 38 },
    ...overrides,
  };
}

describe('FieldExposure comparator', () => {
  it('no drift when a code site exposes the same field on the same channels (matches authored contract)', () => {
    const drifts = compareFieldExposure({
      ref,
      origin: null,
      contract: specExposure(),
      codeExposures: [mkCode()],
    });
    expect(drifts).toEqual([]);
  });

  it('matches by structure, not by author-chosen name (cross-convention target)', () => {
    // Spec uses snake_case; code uses camelCase. Same field, different style.
    const drifts = compareFieldExposure({
      ref,
      origin: null,
      contract: specExposure({ target: { field: 'loyalty_tier' } }),
      codeExposures: [mkCode()], // camelCase code exposure
    });
    expect(drifts).toEqual([]);
  });

  it('tolerates extra code-side channels the contract does not require', () => {
    // Spec only requires api-response; code exposes via both — not drift.
    const drifts = compareFieldExposure({
      ref,
      origin: null,
      contract: specExposure({ exposedVia: ['api-response'] }),
      codeExposures: [mkCode()],
    });
    expect(drifts).toEqual([]);
  });

  it('fires not-exposed when no code site projects or returns this field', () => {
    const drifts = compareFieldExposure({
      ref,
      origin: null,
      contract: specExposure(),
      codeExposures: [], // code dropped the field from every read path
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('field-exposure.customer.loyalty-tier-exposed.not-exposed');
    expect(drifts[0].severity).toBe('high');
    expect(drifts[0].codeSide).toBe('<no projection/response site found>');
  });

  it('fires not-exposed when an exposure exists only on a different field', () => {
    const drifts = compareFieldExposure({
      ref,
      origin: null,
      contract: specExposure(),
      codeExposures: [mkCode({ contract: { target: { field: 'someOtherField' }, exposedVia: ['query-select', 'api-response'] } })],
    });
    expect(drifts.map((d) => d.obligationKey)).toEqual([
      'field-exposure.customer.loyalty-tier-exposed.not-exposed',
    ]);
  });

  it('fires channel-missing when the field is exposed but not on a required channel', () => {
    // Spec requires both channels; code only returns it in the response (never
    // selects it in the projection) — the read path is incomplete.
    const drifts = compareFieldExposure({
      ref,
      origin: null,
      contract: specExposure({ exposedVia: ['query-select', 'api-response'] }),
      codeExposures: [mkCode({ contract: { target: { field: 'loyaltyTier' }, exposedVia: ['api-response'] } })],
    });
    expect(drifts).toHaveLength(1);
    expect(drifts[0].obligationKey).toBe('field-exposure.customer.loyalty-tier-exposed.channel-missing');
    expect(drifts[0].severity).toBe('high');
    expect(drifts[0].specSide).toBe('query-select + api-response');
    expect(drifts[0].codeSide).toBe('api-response');
  });

  it('unions channels across multiple code records for the same field', () => {
    // The same field exposed via query-select in one record and api-response in
    // another (e.g. before the dispatcher's dedup) still satisfies a
    // both-channels contract.
    const drifts = compareFieldExposure({
      ref,
      origin: null,
      contract: specExposure({ exposedVia: ['query-select', 'api-response'] }),
      codeExposures: [
        mkCode({ contract: { target: { field: 'loyaltyTier' }, exposedVia: ['query-select'] } }),
        mkCode({ contract: { target: { field: 'loyaltyTier' }, exposedVia: ['api-response'] } }),
      ],
    });
    expect(drifts).toEqual([]);
  });
});
