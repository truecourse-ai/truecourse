import { describe, it, expect } from 'vitest';
import type { ServiceInfo, ServiceDependencyInfo } from '../../packages/shared/src/types';
import { checkServiceRules } from '../../packages/analyzer/src/rules/architecture/checker';
import { ARCHITECTURE_DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules/architecture/deterministic';

const enabledRules = ARCHITECTURE_DETERMINISTIC_RULES.filter((r) => r.enabled);

function makeService(overrides: Partial<ServiceInfo>): ServiceInfo {
  return {
    name: 'my-service',
    rootPath: '/repo/my-service',
    type: 'http-server',
    fileCount: 5,
    layers: [],
    files: [],
    ...overrides,
  };
}

function makeDep(source: string, target: string): ServiceDependencyInfo {
  return {
    source,
    target,
    dependencies: [{ filePath: '/repo/src/a.ts', importedFrom: '/repo/src/b.ts', importedNames: ['something'] }],
  };
}

describe('checkServiceRules', () => {
  // Circular dependency
  it('detects circular service dependency', () => {
    const services = [makeService({ name: 'A' }), makeService({ name: 'B' })];
    const deps = [makeDep('A', 'B'), makeDep('B', 'A')];

    const violations = checkServiceRules(services, deps, enabledRules);

    const circular = violations.filter((v) => v.ruleKey === 'architecture/deterministic/circular-service-dependency');
    expect(circular).toHaveLength(1);
    expect(circular[0].title).toContain('A');
    expect(circular[0].title).toContain('B');
    expect(circular[0].relatedServiceName).toBeDefined();
  });

  it('does not flag one-way dependency', () => {
    const services = [makeService({ name: 'A' }), makeService({ name: 'B' })];
    const deps = [makeDep('A', 'B')];

    const violations = checkServiceRules(services, deps, enabledRules);

    const circular = violations.filter((v) => v.ruleKey === 'architecture/deterministic/circular-service-dependency');
    expect(circular).toHaveLength(0);
  });

  it('reports circular dependency only once per pair', () => {
    const services = [makeService({ name: 'X' }), makeService({ name: 'Y' })];
    const deps = [makeDep('X', 'Y'), makeDep('Y', 'X')];

    const violations = checkServiceRules(services, deps, enabledRules);

    const circular = violations.filter((v) => v.ruleKey === 'architecture/deterministic/circular-service-dependency');
    expect(circular).toHaveLength(1);
  });

  it('detects multiple circular pairs', () => {
    const services = [
      makeService({ name: 'A' }),
      makeService({ name: 'B' }),
      makeService({ name: 'C' }),
      makeService({ name: 'D' }),
    ];
    const deps = [makeDep('A', 'B'), makeDep('B', 'A'), makeDep('C', 'D'), makeDep('D', 'C')];

    const violations = checkServiceRules(services, deps, enabledRules);

    const circular = violations.filter((v) => v.ruleKey === 'architecture/deterministic/circular-service-dependency');
    expect(circular).toHaveLength(2);
  });

  // God service
  it('detects god service by file count (>20)', () => {
    const services = [makeService({ name: 'big-svc', fileCount: 25 })];

    const violations = checkServiceRules(services, [], enabledRules);

    const god = violations.filter((v) => v.ruleKey === 'architecture/deterministic/god-service');
    expect(god).toHaveLength(1);
    expect(god[0].title).toContain('big-svc');
    expect(god[0].description).toContain('25 files');
  });

  it('detects god service by layer count (>=4)', () => {
    const services = [makeService({
      name: 'layered-svc',
      fileCount: 5,
      layers: [
        { layer: 'api', confidence: 90, evidence: [], fileCount: 1, filePaths: [] },
        { layer: 'service', confidence: 90, evidence: [], fileCount: 1, filePaths: [] },
        { layer: 'data', confidence: 90, evidence: [], fileCount: 1, filePaths: [] },
        { layer: 'external', confidence: 90, evidence: [], fileCount: 1, filePaths: [] },
      ],
    })];

    const violations = checkServiceRules(services, [], enabledRules);

    const god = violations.filter((v) => v.ruleKey === 'architecture/deterministic/god-service');
    expect(god).toHaveLength(1);
    expect(god[0].description).toContain('4 layers');
  });

  it('does not flag service with <=20 files and <4 layers', () => {
    const services = [makeService({
      name: 'normal-svc',
      fileCount: 15,
      layers: [
        { layer: 'api', confidence: 90, evidence: [], fileCount: 1, filePaths: [] },
        { layer: 'service', confidence: 90, evidence: [], fileCount: 1, filePaths: [] },
      ],
    })];

    const violations = checkServiceRules(services, [], enabledRules);

    const god = violations.filter((v) => v.ruleKey === 'architecture/deterministic/god-service');
    expect(god).toHaveLength(0);
  });

  // Disabled rules
  it('respects disabled rules', () => {
    const allDisabled = enabledRules.map((r) => ({ ...r, enabled: false }));
    const services = [makeService({ name: 'A', fileCount: 100 }), makeService({ name: 'B' })];
    const deps = [makeDep('A', 'B'), makeDep('B', 'A')];

    const violations = checkServiceRules(services, deps, allDisabled);
    expect(violations).toHaveLength(0);
  });

  it('returns empty for no services', () => {
    const violations = checkServiceRules([], [], enabledRules);
    expect(violations).toHaveLength(0);
  });
});
