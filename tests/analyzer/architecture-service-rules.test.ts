import { describe, it, expect } from 'vitest';
import type { ServiceInfo, ServiceDependencyInfo } from '../../packages/shared/src/types';
import { checkServiceRules } from '../../packages/analyzer/src/rules/architecture/checker';
import { ARCHITECTURE_DETERMINISTIC_RULES } from '../../packages/analyzer/src/rules/architecture/deterministic';
import { findCycles, type EdgeMetadata } from '../../packages/analyzer/src/rules/architecture/tarjan';

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
  it('detects circular service dependency (A→B→A)', () => {
    const services = [makeService({ name: 'A' }), makeService({ name: 'B' })];
    const deps = [makeDep('A', 'B'), makeDep('B', 'A')];

    const violations = checkServiceRules(services, deps, enabledRules);

    const circular = violations.filter((v) => v.ruleKey === 'architecture/deterministic/circular-service-dependency');
    expect(circular).toHaveLength(1);
    expect(circular[0].title).toContain('A');
    expect(circular[0].title).toContain('B');
    expect(circular[0].relatedServiceName).toBeDefined();
  });

  it('detects transitive circular dependency (A→B→C→A)', () => {
    const services = [
      makeService({ name: 'A' }),
      makeService({ name: 'B' }),
      makeService({ name: 'C' }),
    ];
    const deps = [makeDep('A', 'B'), makeDep('B', 'C'), makeDep('C', 'A')];

    const violations = checkServiceRules(services, deps, enabledRules);

    const circular = violations.filter((v) => v.ruleKey === 'architecture/deterministic/circular-service-dependency');
    expect(circular).toHaveLength(1);
    expect(circular[0].title).toContain('A');
    expect(circular[0].title).toContain('B');
    expect(circular[0].title).toContain('C');
    expect(circular[0].title).toContain('\u2192');
  });

  it('does not flag one-way dependency', () => {
    const services = [makeService({ name: 'A' }), makeService({ name: 'B' })];
    const deps = [makeDep('A', 'B')];

    const violations = checkServiceRules(services, deps, enabledRules);

    const circular = violations.filter((v) => v.ruleKey === 'architecture/deterministic/circular-service-dependency');
    expect(circular).toHaveLength(0);
  });

  it('does not flag linear chain (A→B→C)', () => {
    const services = [
      makeService({ name: 'A' }),
      makeService({ name: 'B' }),
      makeService({ name: 'C' }),
    ];
    const deps = [makeDep('A', 'B'), makeDep('B', 'C')];

    const violations = checkServiceRules(services, deps, enabledRules);

    const circular = violations.filter((v) => v.ruleKey === 'architecture/deterministic/circular-service-dependency');
    expect(circular).toHaveLength(0);
  });

  it('reports circular dependency only once per cycle', () => {
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
  it('detects god service by file count (>120)', () => {
    const services = [makeService({ name: 'big-svc', fileCount: 125 })];

    const violations = checkServiceRules(services, [], enabledRules);

    const god = violations.filter((v) => v.ruleKey === 'architecture/deterministic/god-service');
    expect(god).toHaveLength(1);
    expect(god[0].title).toContain('big-svc');
    expect(god[0].description).toContain('125 files');
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
        { layer: 'infra', confidence: 90, evidence: [], fileCount: 1, filePaths: [] },
      ],
    })];

    const violations = checkServiceRules(services, [], enabledRules);

    const god = violations.filter((v) => v.ruleKey === 'architecture/deterministic/god-service');
    expect(god).toHaveLength(1);
    expect(god[0].description).toContain('5 layers');
  });

  it('does not flag service with <=120 files and <4 layers', () => {
    const services = [makeService({
      name: 'normal-svc',
      fileCount: 100,
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

describe('findCycles (Tarjan SCC)', () => {
  it('detects simple bidirectional cycle A→B→A', () => {
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);

    const { components, cycles } = findCycles(adjacency);

    expect(components).toHaveLength(1);
    expect(components[0].sort()).toEqual(['A', 'B']);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].chain).toEqual(['A', 'B', 'A']);
  });

  it('detects transitive cycle A→B→C→A', () => {
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set(['A'])],
    ]);

    const { components, cycles } = findCycles(adjacency);

    expect(components).toHaveLength(1);
    expect(components[0].sort()).toEqual(['A', 'B', 'C']);
    expect(cycles).toHaveLength(1);
    // Cycle should contain all three nodes
    const chainNodes = cycles[0].chain.slice(0, -1); // remove trailing repeat
    expect(chainNodes.sort()).toEqual(['A', 'B', 'C']);
  });

  it('returns no cycles for linear chain A→B→C', () => {
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set()],
    ]);

    const { components, cycles } = findCycles(adjacency);

    expect(components).toHaveLength(0);
    expect(cycles).toHaveLength(0);
  });

  it('classifies dynamic cycles as isDynamic', () => {
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);
    const edgeMetadata = new Map<string, EdgeMetadata>([
      ['A::B', { isDynamic: true, isTypeOnly: false }],
      ['B::A', { isDynamic: false, isTypeOnly: false }],
    ]);

    const { cycles } = findCycles(adjacency, edgeMetadata);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].isDynamic).toBe(true);
    expect(cycles[0].isStatic).toBe(false);
    expect(cycles[0].isTypeOnly).toBe(false);
  });

  it('classifies type-only cycles as isTypeOnly', () => {
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);
    const edgeMetadata = new Map<string, EdgeMetadata>([
      ['A::B', { isDynamic: false, isTypeOnly: true }],
      ['B::A', { isDynamic: false, isTypeOnly: true }],
    ]);

    const { cycles } = findCycles(adjacency, edgeMetadata);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].isTypeOnly).toBe(true);
    expect(cycles[0].isStatic).toBe(false);
    expect(cycles[0].isDynamic).toBe(false);
  });

  it('classifies static cycles correctly (no metadata)', () => {
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);

    const { cycles } = findCycles(adjacency);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].isStatic).toBe(true);
    expect(cycles[0].isDynamic).toBe(false);
    expect(cycles[0].isTypeOnly).toBe(false);
  });

  it('detects multiple overlapping cycles in same graph', () => {
    // Graph: A→B, B→A, B→C, C→A (creates two cycles: A→B→A and A→B→C→A)
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A', 'C'])],
      ['C', new Set(['A'])],
    ]);

    const { components, cycles } = findCycles(adjacency);

    // All three nodes form one SCC
    expect(components).toHaveLength(1);
    expect(components[0].sort()).toEqual(['A', 'B', 'C']);
    // Should find both cycles: A→B→A and A→B→C→A
    expect(cycles.length).toBeGreaterThanOrEqual(2);
  });

  it('detects multiple disjoint cycles', () => {
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
      ['C', new Set(['D'])],
      ['D', new Set(['C'])],
    ]);

    const { components, cycles } = findCycles(adjacency);

    expect(components).toHaveLength(2);
    expect(cycles).toHaveLength(2);
  });

  it('handles larger transitive cycle (A→B→C→D→A)', () => {
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['C'])],
      ['C', new Set(['D'])],
      ['D', new Set(['A'])],
    ]);

    const { components, cycles } = findCycles(adjacency);

    expect(components).toHaveLength(1);
    expect(components[0].sort()).toEqual(['A', 'B', 'C', 'D']);
    expect(cycles).toHaveLength(1);
    const chainNodes = cycles[0].chain.slice(0, -1);
    expect(chainNodes.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('handles empty graph', () => {
    const adjacency = new Map<string, Set<string>>();

    const { components, cycles } = findCycles(adjacency);

    expect(components).toHaveLength(0);
    expect(cycles).toHaveLength(0);
  });

  it('handles single node with no edges', () => {
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set()],
    ]);

    const { components, cycles } = findCycles(adjacency);

    expect(components).toHaveLength(0);
    expect(cycles).toHaveLength(0);
  });

  it('mixed type-only: one edge type-only, one not — not isTypeOnly', () => {
    const adjacency = new Map<string, Set<string>>([
      ['A', new Set(['B'])],
      ['B', new Set(['A'])],
    ]);
    const edgeMetadata = new Map<string, EdgeMetadata>([
      ['A::B', { isDynamic: false, isTypeOnly: true }],
      ['B::A', { isDynamic: false, isTypeOnly: false }],
    ]);

    const { cycles } = findCycles(adjacency, edgeMetadata);

    expect(cycles).toHaveLength(1);
    expect(cycles[0].isTypeOnly).toBe(false);
    expect(cycles[0].isStatic).toBe(true);
  });
});
