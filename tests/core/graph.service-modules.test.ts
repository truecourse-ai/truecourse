import { describe, it, expect } from 'vitest';
import { buildUnifiedGraph, type UnifiedInput } from '../../packages/core/src/services/graph.service';

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

function makeLayer(overrides: Record<string, unknown> = {}) {
  return {
    id: 'layer-1',
    serviceName: 'my-service',
    serviceId: 'svc-1',
    layer: 'api',
    fileCount: 3,
    filePaths: ['src/routes/users.ts'],
    confidence: 90,
    evidence: [],
    ...overrides,
  };
}

function makeModule(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mod-1',
    layerId: 'layer-1',
    serviceId: 'svc-1',
    name: 'UserController',
    kind: 'class',
    filePath: 'src/routes/users.ts',
    methodCount: 3,
    propertyCount: 1,
    importCount: 2,
    exportCount: 1,
    superClass: null,
    lineCount: 50,
    ...overrides,
  };
}

function makeModuleDep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mdep-1',
    sourceModuleId: 'mod-1',
    targetModuleId: 'mod-2',
    importedNames: ['UserService'],
    dependencyCount: 1,
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

describe('buildUnifiedGraph (module level)', () => {
  it('creates service group, layer container, and module nodes', () => {
    const services = [makeService()];
    const layers = [makeLayer()];
    const modules = [makeModule()];

    const result = buildUnifiedGraph('module', makeInput({ services, layers, modules }));

    // Should have: 1 service group + 1 layer container + 1 module node
    expect(result.nodes.length).toBe(3);

    const serviceGroup = result.nodes.find((n) => n.type === 'serviceGroupNode');
    expect(serviceGroup).toBeDefined();
    expect(serviceGroup!.data.label).toBe('my-service');

    const layerNode = result.nodes.find((n) => n.type === 'layerNode');
    expect(layerNode).toBeDefined();

    const moduleNode = result.nodes.find((n) => n.type === 'moduleNode');
    expect(moduleNode).toBeDefined();
    expect(moduleNode!.data.label).toBe('UserController');
  });

  it('creates edges between modules with dependencies', () => {
    const services = [makeService()];
    const layers = [
      makeLayer({ id: 'layer-1', layer: 'api' }),
      makeLayer({ id: 'layer-2', layer: 'service' }),
    ];
    const modules = [
      makeModule({ id: 'mod-1', layerId: 'layer-1', name: 'UserController' }),
      makeModule({ id: 'mod-2', layerId: 'layer-2', name: 'UserService' }),
    ];
    const deps = [makeModuleDep({ sourceModuleId: 'mod-1', targetModuleId: 'mod-2' })];

    const result = buildUnifiedGraph('module', makeInput({ services, layers, modules, moduleDeps: deps }));

    // Should have at least one edge between modules
    const moduleEdges = result.edges.filter(
      (e) => e.source === 'mod-1' && e.target === 'mod-2'
    );
    expect(moduleEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('handles multiple services with separate module hierarchies', () => {
    const services = [
      makeService({ id: 'svc-1', name: 'api-gateway' }),
      makeService({ id: 'svc-2', name: 'user-service' }),
    ];
    const layers = [
      makeLayer({ id: 'l1', serviceId: 'svc-1', serviceName: 'api-gateway', layer: 'api' }),
      makeLayer({ id: 'l2', serviceId: 'svc-2', serviceName: 'user-service', layer: 'service' }),
    ];
    const modules = [
      makeModule({ id: 'm1', layerId: 'l1', serviceId: 'svc-1', name: 'Router' }),
      makeModule({ id: 'm2', layerId: 'l2', serviceId: 'svc-2', name: 'UserService' }),
    ];

    const result = buildUnifiedGraph('module', makeInput({ services, layers, modules }));

    const serviceGroups = result.nodes.filter((n) => n.type === 'serviceGroupNode');
    expect(serviceGroups).toHaveLength(2);

    const moduleNodes = result.nodes.filter((n) => n.type === 'moduleNode');
    expect(moduleNodes).toHaveLength(2);
  });

  it('assigns module node as child of layer node', () => {
    const services = [makeService()];
    const layers = [makeLayer()];
    const modules = [makeModule()];

    const result = buildUnifiedGraph('module', makeInput({ services, layers, modules }));

    const moduleNode = result.nodes.find((n) => n.type === 'moduleNode') as Record<string, unknown>;
    const layerNode = result.nodes.find((n) => n.type === 'layerNode');

    expect(moduleNode).toBeDefined();
    expect(moduleNode.parentId).toBe(layerNode!.id);
  });

  it('returns empty graph for no services', () => {
    const result = buildUnifiedGraph('module', makeInput());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('includes module metadata in node data', () => {
    const services = [makeService()];
    const layers = [makeLayer()];
    const modules = [makeModule({ kind: 'class', methodCount: 5, propertyCount: 2 })];

    const result = buildUnifiedGraph('module', makeInput({ services, layers, modules }));

    const moduleNode = result.nodes.find((n) => n.type === 'moduleNode');
    expect(moduleNode).toBeDefined();
    const data = moduleNode!.data as Record<string, unknown>;
    expect(data.moduleKind).toBe('class');
    expect(data.methodCount).toBe(5);
  });
});
