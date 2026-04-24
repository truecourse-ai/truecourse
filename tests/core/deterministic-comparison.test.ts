import { describe, it, expect } from 'vitest';
import { compareDeterministicViolations } from '../../packages/core/src/services/violation-pipeline.service.js';

describe('compareDeterministicViolations', () => {
  it('identifies new detections (current exists, previous does not)', () => {
    const current = [
      { ruleKey: 'god-service', serviceName: 'api', title: 'God service: api', moduleName: null, methodName: null },
    ];
    const previous: typeof current = [];

    const result = compareDeterministicViolations(current, previous);

    expect(result.newDetections).toHaveLength(1);
    expect(result.newDetections[0].ruleKey).toBe('god-service');
    expect(result.unchangedDetections).toHaveLength(0);
    expect(result.resolvedDetections).toHaveLength(0);
  });

  it('identifies unchanged detections (both have same key)', () => {
    const current = [
      { ruleKey: 'circular-dep', serviceName: 'api', title: 'Circular dep: api', moduleName: null, methodName: null },
    ];
    const previous = [
      { ruleKey: 'circular-dep', serviceName: 'api', title: 'Circular dep: api', moduleName: null, methodName: null },
    ];

    const result = compareDeterministicViolations(current, previous);

    expect(result.newDetections).toHaveLength(0);
    expect(result.unchangedDetections).toHaveLength(1);
    expect(result.unchangedDetections[0].current.ruleKey).toBe('circular-dep');
    expect(result.unchangedDetections[0].previous.ruleKey).toBe('circular-dep');
    expect(result.resolvedDetections).toHaveLength(0);
  });

  it('identifies resolved detections (previous exists, current does not)', () => {
    const current: { ruleKey: string; serviceName: string; title: string; moduleName: string | null; methodName: string | null }[] = [];
    const previous = [
      { ruleKey: 'god-service', serviceName: 'api', title: 'God service: api', moduleName: null, methodName: null },
    ];

    const result = compareDeterministicViolations(current, previous);

    expect(result.newDetections).toHaveLength(0);
    expect(result.unchangedDetections).toHaveLength(0);
    expect(result.resolvedDetections).toHaveLength(1);
    expect(result.resolvedDetections[0].ruleKey).toBe('god-service');
  });

  it('handles mixed scenario correctly', () => {
    const current = [
      { ruleKey: 'circular-dep', serviceName: 'api', title: 'Circular dep: api', moduleName: null, methodName: null },
      { ruleKey: 'god-service', serviceName: 'api', title: 'God service: api', moduleName: null, methodName: null },
      { ruleKey: 'high-complexity', serviceName: 'auth', title: 'High complexity: validate', moduleName: 'AuthService', methodName: 'validate' },
    ];
    const previous = [
      { ruleKey: 'circular-dep', serviceName: 'api', title: 'Circular dep: api', moduleName: null, methodName: null },
      { ruleKey: 'unused-export', serviceName: 'auth', title: 'Unused export: login', moduleName: 'AuthService', methodName: null },
    ];

    const result = compareDeterministicViolations(current, previous);

    // god-service and high-complexity are new
    expect(result.newDetections).toHaveLength(2);
    expect(result.newDetections.map((d) => d.ruleKey).sort()).toEqual(['god-service', 'high-complexity']);

    // circular-dep is unchanged
    expect(result.unchangedDetections).toHaveLength(1);
    expect(result.unchangedDetections[0].current.ruleKey).toBe('circular-dep');

    // unused-export is resolved
    expect(result.resolvedDetections).toHaveLength(1);
    expect(result.resolvedDetections[0].ruleKey).toBe('unused-export');
  });

  it('handles empty arrays for both current and previous', () => {
    const result = compareDeterministicViolations([], []);

    expect(result.newDetections).toHaveLength(0);
    expect(result.unchangedDetections).toHaveLength(0);
    expect(result.resolvedDetections).toHaveLength(0);
  });

  it('uses moduleName and methodName in comparison key', () => {
    const current = [
      { ruleKey: 'high-complexity', serviceName: 'api', title: 'High complexity: create', moduleName: 'UserService', methodName: 'create' },
    ];
    const previous = [
      { ruleKey: 'high-complexity', serviceName: 'api', title: 'High complexity: delete', moduleName: 'UserService', methodName: 'delete' },
    ];

    const result = compareDeterministicViolations(current, previous);

    // Different method → different key → new + resolved
    expect(result.newDetections).toHaveLength(1);
    expect(result.newDetections[0].methodName).toBe('create');
    expect(result.resolvedDetections).toHaveLength(1);
    expect(result.resolvedDetections[0].methodName).toBe('delete');
    expect(result.unchangedDetections).toHaveLength(0);
  });

  it('disambiguates same rule+service with different titles', () => {
    const current = [
      { ruleKey: 'architecture/deterministic/orphan-file', serviceName: 'api-gateway', title: 'Orphan file: auth.ts', moduleName: null, methodName: null },
      { ruleKey: 'architecture/deterministic/orphan-file', serviceName: 'api-gateway', title: 'Orphan file: redis.ts', moduleName: null, methodName: null },
    ];
    const previous = [
      { ruleKey: 'architecture/deterministic/orphan-file', serviceName: 'api-gateway', title: 'Orphan file: auth.ts', moduleName: null, methodName: null },
      { ruleKey: 'architecture/deterministic/orphan-file', serviceName: 'api-gateway', title: 'Orphan file: redis.ts', moduleName: null, methodName: null },
    ];

    const result = compareDeterministicViolations(current, previous);

    expect(result.newDetections).toHaveLength(0);
    expect(result.unchangedDetections).toHaveLength(2);
    expect(result.resolvedDetections).toHaveLength(0);
    // Verify correct pairing
    const authPair = result.unchangedDetections.find((d) => d.current.title === 'Orphan file: auth.ts');
    expect(authPair?.previous.title).toBe('Orphan file: auth.ts');
    const redisPair = result.unchangedDetections.find((d) => d.current.title === 'Orphan file: redis.ts');
    expect(redisPair?.previous.title).toBe('Orphan file: redis.ts');
  });
});
