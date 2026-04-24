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
    methodCount: 2,
    propertyCount: 0,
    importCount: 1,
    exportCount: 1,
    superClass: null,
    lineCount: 30,
    ...overrides,
  };
}

function makeMethod(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mth-1',
    moduleId: 'mod-1',
    name: 'getAll',
    signature: 'getAll(): Promise<User[]>',
    paramCount: 0,
    returnType: 'Promise<User[]>',
    isAsync: true,
    isExported: true,
    lineCount: 10,
    statementCount: 5,
    maxNestingDepth: 1,
    ...overrides,
  };
}

function makeMethodDep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mthdep-1',
    sourceMethodId: 'mth-1',
    targetMethodId: 'mth-2',
    callCount: 1,
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

describe('buildUnifiedGraph (method level)', () => {
  it('creates service group, layer, module container, and method nodes', () => {
    const services = [makeService()];
    const layers = [makeLayer()];
    const modules = [makeModule()];
    const methods = [
      makeMethod({ id: 'mth-1', name: 'getAll' }),
      makeMethod({ id: 'mth-2', name: 'create' }),
    ];

    const result = buildUnifiedGraph('method', makeInput({ services, layers, modules, methods }));

    const serviceGroup = result.nodes.find((n) => n.type === 'serviceGroupNode');
    expect(serviceGroup).toBeDefined();

    const layerNode = result.nodes.find((n) => n.type === 'layerNode');
    expect(layerNode).toBeDefined();

    const moduleNode = result.nodes.find((n) => n.type === 'moduleNode');
    expect(moduleNode).toBeDefined();
    // Module should be a container in method mode
    expect((moduleNode!.data as Record<string, unknown>).isContainer).toBe(true);

    const methodNodes = result.nodes.filter((n) => n.type === 'methodNode');
    expect(methodNodes).toHaveLength(2);
  });

  it('assigns method nodes as children of module container', () => {
    const services = [makeService()];
    const layers = [makeLayer()];
    const modules = [makeModule()];
    const methods = [makeMethod()];

    const result = buildUnifiedGraph('method', makeInput({ services, layers, modules, methods }));

    const methodNode = result.nodes.find((n) => n.type === 'methodNode') as Record<string, unknown>;
    expect(methodNode).toBeDefined();
    expect(methodNode.parentId).toBe('mod-1');
  });

  it('creates method-to-method edges from method deps', () => {
    const services = [makeService()];
    const layers = [
      makeLayer({ id: 'layer-1', layer: 'api' }),
      makeLayer({ id: 'layer-2', layer: 'service' }),
    ];
    const modules = [
      makeModule({ id: 'mod-1', layerId: 'layer-1', name: 'Controller' }),
      makeModule({ id: 'mod-2', layerId: 'layer-2', name: 'Service' }),
    ];
    const methods = [
      makeMethod({ id: 'mth-1', moduleId: 'mod-1', name: 'getAll' }),
      makeMethod({ id: 'mth-2', moduleId: 'mod-2', name: 'findAll' }),
    ];
    const methodDeps = [makeMethodDep({ sourceMethodId: 'mth-1', targetMethodId: 'mth-2' })];

    const result = buildUnifiedGraph('method', makeInput({ services, layers, modules, methods, methodDeps }));

    const methodEdges = result.edges.filter(
      (e) => e.source === 'mth-1' && e.target === 'mth-2'
    );
    expect(methodEdges.length).toBeGreaterThanOrEqual(1);
  });

  it('includes method metadata in node data', () => {
    const services = [makeService()];
    const layers = [makeLayer()];
    const modules = [makeModule()];
    const methods = [makeMethod({
      name: 'processData',
      isAsync: true,
      isExported: true,
      paramCount: 3,
      statementCount: 15,
      maxNestingDepth: 3,
    })];

    const result = buildUnifiedGraph('method', makeInput({ services, layers, modules, methods }));

    const methodNode = result.nodes.find((n) => n.type === 'methodNode');
    expect(methodNode).toBeDefined();
    const data = methodNode!.data as Record<string, unknown>;
    expect(data.label).toBe('processData');
    expect(data.isAsync).toBe(true);
    expect(data.isExported).toBe(true);
    expect(data.paramCount).toBe(3);
    expect(data.statementCount).toBe(15);
    expect(data.maxNestingDepth).toBe(3);
  });

  it('shows module dep edge as fallback when no method edges exist between modules', () => {
    const services = [makeService()];
    const layers = [
      makeLayer({ id: 'layer-1', layer: 'api' }),
      makeLayer({ id: 'layer-2', layer: 'service' }),
    ];
    const modules = [
      makeModule({ id: 'mod-1', layerId: 'layer-1', name: 'Controller' }),
      makeModule({ id: 'mod-2', layerId: 'layer-2', name: 'Service' }),
    ];
    const methods = [
      makeMethod({ id: 'mth-1', moduleId: 'mod-1' }),
      makeMethod({ id: 'mth-2', moduleId: 'mod-2' }),
    ];
    const moduleDeps = [{
      id: 'mdep-1',
      sourceModuleId: 'mod-1',
      targetModuleId: 'mod-2',
      importedNames: ['Service'],
      dependencyCount: 1,
    }];

    const result = buildUnifiedGraph('method', makeInput({ services, layers, modules, methods, moduleDeps }));

    // Module dep edge appears as fallback since no method-level edges exist
    const modEdges = result.edges.filter(
      (e) => e.source === 'mod-1' && e.target === 'mod-2'
    );
    expect(modEdges).toHaveLength(1);
  });

  it('does not duplicate module dep edge when method edges exist between same modules', () => {
    const services = [makeService()];
    const layers = [
      makeLayer({ id: 'layer-1', layer: 'api' }),
      makeLayer({ id: 'layer-2', layer: 'service' }),
    ];
    const modules = [
      makeModule({ id: 'mod-1', layerId: 'layer-1', name: 'Controller' }),
      makeModule({ id: 'mod-2', layerId: 'layer-2', name: 'Service' }),
    ];
    const methods = [
      makeMethod({ id: 'mth-1', moduleId: 'mod-1' }),
      makeMethod({ id: 'mth-2', moduleId: 'mod-2' }),
    ];
    const moduleDeps = [{
      id: 'mdep-1',
      sourceModuleId: 'mod-1',
      targetModuleId: 'mod-2',
      importedNames: ['Service'],
      dependencyCount: 1,
    }];
    const methodDeps = [makeMethodDep({ sourceMethodId: 'mth-1', targetMethodId: 'mth-2' })];

    const result = buildUnifiedGraph('method', makeInput({ services, layers, modules, methods, moduleDeps, methodDeps }));

    // Only method edge, no duplicate module dep edge
    const modEdges = result.edges.filter(
      (e) => e.source === 'mod-1' && e.target === 'mod-2'
    );
    expect(modEdges).toHaveLength(0);
  });

  it('returns empty graph for no services', () => {
    const result = buildUnifiedGraph('method', makeInput());
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
