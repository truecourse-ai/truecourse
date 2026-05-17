import { describe, it, expect } from 'vitest';
import { driftToViolation, driftsToViolations } from '../../packages/contract-verifier/src/adapter/violation.js';
import type { ContractDrift } from '../../packages/contract-verifier/src/types/index.js';
import { ViolationCategorySchema } from '../../packages/shared/src/types/violations.js';

const sampleDrift: ContractDrift = {
  id: 'drift-1',
  type: 'contract-drift',
  artifactRef: { type: 'Operation', identity: 'POST /api/orders', quoted: true },
  obligationKey: 'response.201',
  severity: 'critical',
  filePath: '/repo/src/orders.controller.ts',
  lineStart: 18,
  lineEnd: 18,
  message: 'Spec declares 201 but code returns 200.',
  specSide: 'response 201 on success',
  codeSide: 'code emits status: 200',
};

describe('contract-drift → violation adapter', () => {
  it('produces a stable ruleKey keyed by artifact + obligation', () => {
    const v = driftToViolation(sampleDrift);
    expect(v.ruleKey).toBe('contract-drift/Operation/response.201');
  });

  it('sets category and subcategory for filtering', () => {
    const v = driftToViolation(sampleDrift);
    expect(v.category).toBe('contract-drift');
    expect(v.subcategory).toBe('Operation');
  });

  it('preserves severity and source location', () => {
    const v = driftToViolation(sampleDrift);
    expect(v.severity).toBe('critical');
    expect(v.filePath).toBe('/repo/src/orders.controller.ts');
    expect(v.lineStart).toBe(18);
    expect(v.lineEnd).toBe(18);
  });

  it('builds a human title from artifact:identity · obligationKey', () => {
    const v = driftToViolation(sampleDrift);
    expect(v.title).toBe('Operation:POST /api/orders · response.201');
  });

  it('includes spec/code side blurbs in the content body when present', () => {
    const v = driftToViolation(sampleDrift);
    expect(v.content).toContain('Spec declares 201 but code returns 200.');
    expect(v.content).toContain('Spec: response 201 on success');
    expect(v.content).toContain('Code: code emits status: 200');
  });

  it('omits spec/code blurbs when the drift has none', () => {
    const minimalDrift: ContractDrift = {
      ...sampleDrift,
      specSide: undefined,
      codeSide: undefined,
    };
    const v = driftToViolation(minimalDrift);
    expect(v.content).toBe('Spec declares 201 but code returns 200.');
    expect(v.content).not.toContain('Spec:');
    expect(v.content).not.toContain('Code:');
  });

  it('emits a category value the shared ViolationCategorySchema accepts', () => {
    // Pinning the category enum guards against drift between this package
    // and `@truecourse/shared` — if the shared enum loses 'contract-drift'
    // the adapter must fail loudly here rather than silently.
    const v = driftToViolation(sampleDrift);
    expect(() => ViolationCategorySchema.parse(v.category)).not.toThrow();
  });

  it('bulk variant maps every input', () => {
    const drifts = [sampleDrift, { ...sampleDrift, id: 'drift-2', obligationKey: 'response.400' }];
    const out = driftsToViolations(drifts);
    expect(out).toHaveLength(2);
    expect(out[0].ruleKey).toBe('contract-drift/Operation/response.201');
    expect(out[1].ruleKey).toBe('contract-drift/Operation/response.400');
  });
});
