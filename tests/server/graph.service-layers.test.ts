import { describe, it, expect } from 'vitest';
import { buildLayerGraphData } from '../../apps/server/src/services/graph.service';

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

function makeLayerData(overrides: Record<string, unknown> = {}) {
  return {
    id: 'layer-1',
    serviceName: 'my-service',
    serviceId: 'svc-1',
    layer: 'api',
    fileCount: 3,
    filePaths: ['src/routes/users.ts', 'src/routes/health.ts', 'src/index.ts'],
    confidence: 90,
    evidence: ['Imports API framework: express'],
    ...overrides,
  };
}

function makeLayerDep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ldep-1',
    sourceServiceName: 'my-service',
    sourceLayer: 'api',
    targetServiceName: 'my-service',
    targetLayer: 'service',
    dependencyCount: 4,
    isViolation: false,
    violationReason: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildLayerGraphData', () => {
  it('returns empty graph for empty input', () => {
    const result = buildLayerGraphData([], [], [], []);
    expect(result).toEqual({ nodes: [], edges: [] });
  });

  it('creates serviceGroupNode and layerNode for a service with layers', () => {
    const services = [makeService()];
    const layers = [
      makeLayerData({ id: 'l1', layer: 'api', fileCount: 3 }),
      makeLayerData({ id: 'l2', layer: 'service', fileCount: 7 }),
    ];

    const result = buildLayerGraphData(services, [], layers, []);

    const groupNodes = result.nodes.filter((n) => n.type === 'serviceGroupNode');
    const layerNodes = result.nodes.filter((n) => n.type === 'layerNode');

    expect(groupNodes).toHaveLength(1);
    expect(groupNodes[0].id).toBe('svc-1');
    expect(groupNodes[0].data.label).toBe('my-service');

    expect(layerNodes).toHaveLength(2);
    expect(layerNodes.map((n) => n.data.label).sort()).toEqual(['api', 'service']);
  });

  it('layer nodes have parentId pointing to service group', () => {
    const services = [makeService()];
    const layers = [makeLayerData()];

    const result = buildLayerGraphData(services, [], layers, []);
    const layerNode = result.nodes.find((n) => n.type === 'layerNode')!;

    expect((layerNode as Record<string, unknown>).parentId).toBe('svc-1');
  });

  it('layer node IDs follow serviceId__layer pattern', () => {
    const services = [makeService()];
    const layers = [makeLayerData({ layer: 'api' })];

    const result = buildLayerGraphData(services, [], layers, []);
    const layerNode = result.nodes.find((n) => n.type === 'layerNode')!;

    expect(layerNode.id).toBe('svc-1__api');
  });

  it('shows intra-service layer deps as edges with right-side handles', () => {
    const services = [makeService()];
    const layers = [
      makeLayerData({ id: 'l1', layer: 'api' }),
      makeLayerData({ id: 'l2', layer: 'service' }),
    ];
    const layerDeps = [makeLayerDep()];

    const result = buildLayerGraphData(services, [], layers, layerDeps);

    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0];
    expect(edge.source).toBe('svc-1__api');
    expect(edge.target).toBe('svc-1__service');
    expect((edge as Record<string, unknown>).sourceHandle).toBe('right-src');
    expect((edge as Record<string, unknown>).targetHandle).toBe('right-tgt');
  });

  it('shows violations as edges with isViolation flag', () => {
    const services = [makeService()];
    const layers = [
      makeLayerData({ id: 'l1', layer: 'data' }),
      makeLayerData({ id: 'l2', layer: 'api' }),
    ];
    const layerDeps = [
      makeLayerDep({
        id: 'ldep-v',
        sourceLayer: 'data',
        targetLayer: 'api',
        isViolation: true,
        violationReason: 'data layer should not depend on api layer',
      }),
    ];

    const result = buildLayerGraphData(services, [], layers, layerDeps);

    expect(result.edges).toHaveLength(1);
    const edge = result.edges[0];
    expect(edge.data.dependencyType).toBe('violation');
    expect((edge.data as Record<string, unknown>).isViolation).toBe(true);
    expect((edge as Record<string, unknown>).sourceHandle).toBe('right-src');
    expect((edge as Record<string, unknown>).targetHandle).toBe('right-tgt');
  });

  it('creates edges for cross-service layer deps', () => {
    const services = [
      makeService({ id: 'svc-1', name: 'svc-a' }),
      makeService({ id: 'svc-2', name: 'svc-b' }),
    ];
    const layers = [
      makeLayerData({ id: 'l1', serviceName: 'svc-a', serviceId: 'svc-1', layer: 'external' }),
      makeLayerData({ id: 'l2', serviceName: 'svc-b', serviceId: 'svc-2', layer: 'service' }),
    ];
    const layerDeps = [
      makeLayerDep({
        id: 'ldep-cross',
        sourceServiceName: 'svc-a',
        sourceLayer: 'external',
        targetServiceName: 'svc-b',
        targetLayer: 'service',
        dependencyCount: 2,
      }),
    ];

    const result = buildLayerGraphData(services, [], layers, layerDeps);

    const crossEdge = result.edges.find((e) => e.id === 'ldep-cross');
    expect(crossEdge).toBeDefined();
    expect(crossEdge!.source).toBe('svc-1__external');
    expect(crossEdge!.target).toBe('svc-2__service');
    expect((crossEdge as Record<string, unknown>).sourceHandle).toBe('bottom');
    expect((crossEdge as Record<string, unknown>).targetHandle).toBe('top');
  });

  it('does not include service-level edges between groups', () => {
    const services = [
      makeService({ id: 'svc-1', name: 'frontend' }),
      makeService({ id: 'svc-2', name: 'backend' }),
    ];
    const deps = [makeDependency()];

    const result = buildLayerGraphData(services, deps, [], []);

    // Only layer-to-layer edges should exist, not service-to-service
    const svcEdges = result.edges.filter(
      (e) => e.source === 'svc-1' || e.source === 'svc-2'
    );
    expect(svcEdges).toHaveLength(0);
  });

  it('assigns valid coordinates to all nodes', () => {
    const services = [
      makeService({ id: 'svc-1', name: 'svc-a' }),
      makeService({ id: 'svc-2', name: 'svc-b' }),
    ];
    const layers = [
      makeLayerData({ id: 'l1', serviceName: 'svc-a', serviceId: 'svc-1', layer: 'api' }),
      makeLayerData({ id: 'l2', serviceName: 'svc-b', serviceId: 'svc-2', layer: 'data' }),
    ];

    const result = buildLayerGraphData(services, [], layers, []);

    for (const node of result.nodes) {
      expect(typeof node.position.x).toBe('number');
      expect(typeof node.position.y).toBe('number');
      expect(Number.isNaN(node.position.x)).toBe(false);
      expect(Number.isNaN(node.position.y)).toBe(false);
    }
  });

  it('orders layers: api before service before data before external', () => {
    const services = [makeService()];
    const layers = [
      makeLayerData({ id: 'l1', layer: 'external' }),
      makeLayerData({ id: 'l2', layer: 'data' }),
      makeLayerData({ id: 'l3', layer: 'api' }),
      makeLayerData({ id: 'l4', layer: 'service' }),
    ];

    const result = buildLayerGraphData(services, [], layers, []);
    const layerNodes = result.nodes.filter((n) => n.type === 'layerNode');

    // Layer nodes should be ordered by y position within the group
    const sorted = [...layerNodes].sort((a, b) => a.position.y - b.position.y);
    const layerOrder = sorted.map((n) => n.data.label);
    expect(layerOrder).toEqual(['api', 'service', 'data', 'external']);
  });
});
