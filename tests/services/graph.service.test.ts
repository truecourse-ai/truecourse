import { describe, it, expect } from 'vitest';
import { buildUnifiedGraph, type UnifiedInput } from '../../apps/server/src/services/graph.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeService(overrides: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    name: 'my-service',
    type: 'api-server',
    framework: 'express',
    fileCount: 10,
    description: null,
    layerSummary: [{ layer: 'api' }, { layer: 'service' }],
    rootPath: 'services/my-service',
    ...overrides,
  };
}

function makeDependency(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dep-1',
    sourceServiceId: 'svc-1',
    targetServiceId: 'svc-2',
    dependencyCount: 5,
    dependencyType: 'import',
    ...overrides,
  };
}

function makeInput(overrides: Partial<UnifiedInput> = {}): UnifiedInput {
  return {
    services: [],
    serviceDeps: [],
    layers: [],
    modules: [],
    moduleDeps: [],
    methods: [],
    methodDeps: [],
    databases: [],
    dbConnections: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildUnifiedGraph (service level)', () => {
  it('returns empty nodes and edges for empty input', () => {
    const result = buildUnifiedGraph('service', makeInput());
    expect(result).toEqual({ nodes: [], edges: [] });
  });

  it('returns 1 node with correct data for a single service', () => {
    const svc = makeService();
    const result = buildUnifiedGraph('service', makeInput({ services: [svc] }));

    expect(result.nodes).toHaveLength(1);
    const node = result.nodes[0];
    expect(node.id).toBe('svc-1');
    expect(node.type).toBe('serviceNode');
    expect(node.data.label).toBe('my-service');
    expect(node.data.serviceType).toBe('api-server');
    expect(node.data.framework).toBe('express');
    expect(node.data.fileCount).toBe(10);
    expect(node.data.rootPath).toBe('services/my-service');
  });

  it('assigns x,y coordinates to all nodes (no NaN)', () => {
    const services = [
      makeService({ id: 'a', name: 'svc-a', type: 'frontend' }),
      makeService({ id: 'b', name: 'svc-b', type: 'api-server' }),
      makeService({ id: 'c', name: 'svc-c', type: 'worker' }),
    ];
    const result = buildUnifiedGraph('service', makeInput({ services }));

    for (const node of result.nodes) {
      expect(typeof node.position.x).toBe('number');
      expect(typeof node.position.y).toBe('number');
      expect(Number.isNaN(node.position.x)).toBe(false);
      expect(Number.isNaN(node.position.y)).toBe(false);
    }
  });

  it('positions frontend higher (lower y) than api-server', () => {
    const services = [
      makeService({ id: 'fe', name: 'frontend', type: 'frontend' }),
      makeService({ id: 'api', name: 'api-server', type: 'api-server' }),
    ];
    const deps = [makeDependency({ id: 'd1', sourceServiceId: 'fe', targetServiceId: 'api' })];
    const result = buildUnifiedGraph('service', makeInput({ services, serviceDeps: deps }));

    const feNode = result.nodes.find((n) => n.id === 'fe')!;
    const apiNode = result.nodes.find((n) => n.id === 'api')!;
    expect(feNode.position.y).toBeLessThan(apiNode.position.y);
  });

  it('positions api-server higher (lower y) than worker/library', () => {
    const services = [
      makeService({ id: 'api', name: 'api', type: 'api-server' }),
      makeService({ id: 'wk', name: 'worker', type: 'worker' }),
      makeService({ id: 'lib', name: 'lib', type: 'library' }),
    ];
    const deps = [
      makeDependency({ id: 'd1', sourceServiceId: 'api', targetServiceId: 'wk' }),
      makeDependency({ id: 'd2', sourceServiceId: 'api', targetServiceId: 'lib' }),
    ];
    const result = buildUnifiedGraph('service', makeInput({ services, serviceDeps: deps }));

    const apiNode = result.nodes.find((n) => n.id === 'api')!;
    const wkNode = result.nodes.find((n) => n.id === 'wk')!;
    const libNode = result.nodes.find((n) => n.id === 'lib')!;
    expect(apiNode.position.y).toBeLessThan(wkNode.position.y);
    expect(apiNode.position.y).toBeLessThan(libNode.position.y);
  });

  it('creates edges with correct source and target', () => {
    const services = [
      makeService({ id: 'svc-1', name: 'svc-a' }),
      makeService({ id: 'svc-2', name: 'svc-b' }),
    ];
    const deps = [makeDependency()];
    const result = buildUnifiedGraph('service', makeInput({ services, serviceDeps: deps }));

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].source).toBe('svc-1');
    expect(result.edges[0].target).toBe('svc-2');
  });

  it('edge has label from dependencyCount', () => {
    const services = [
      makeService({ id: 'svc-1' }),
      makeService({ id: 'svc-2' }),
    ];
    const deps = [makeDependency({ dependencyCount: 42 })];
    const result = buildUnifiedGraph('service', makeInput({ services, serviceDeps: deps }));

    expect(result.edges[0].label).toBe('42');
    expect(result.edges[0].data.dependencyCount).toBe(42);
  });

  it('handles null framework gracefully', () => {
    const svc = makeService({ framework: null });
    const result = buildUnifiedGraph('service', makeInput({ services: [svc] }));

    expect(result.nodes[0].data.framework).toBeUndefined();
  });

  it('handles null fileCount gracefully', () => {
    const svc = makeService({ fileCount: null });
    const result = buildUnifiedGraph('service', makeInput({ services: [svc] }));

    expect(result.nodes[0].data.fileCount).toBe(0);
  });

  it('returns layers from layer rows', () => {
    const svc = makeService();
    const layerRows = [
      { id: 'l1', serviceName: 'my-service', serviceId: 'svc-1', layer: 'api', fileCount: 3, filePaths: [], confidence: 90, evidence: [] },
      { id: 'l2', serviceName: 'my-service', serviceId: 'svc-1', layer: 'service', fileCount: 3, filePaths: [], confidence: 90, evidence: [] },
    ];
    const result = buildUnifiedGraph('service', makeInput({ services: [svc], layers: layerRows }));

    expect(result.nodes[0].data.layers).toEqual(['api', 'service']);
  });

  it('returns empty layers array when no layer rows exist', () => {
    const svc = makeService();
    const result = buildUnifiedGraph('service', makeInput({ services: [svc] }));

    expect(result.nodes[0].data.layers).toEqual([]);
  });
});
