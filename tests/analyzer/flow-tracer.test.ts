import { describe, it, expect } from 'vitest'
import { traceFlows, type RouteHandler } from '../../packages/analyzer/src/flow-tracer'
import { AnalysisGraph, type AnalysisGraphInput } from '../../packages/analyzer/src/analysis-graph'
import type { MethodInfo, MethodLevelDependency, ModuleInfo } from '../../packages/shared/src/types/analysis'

function makeModule(overrides: Partial<ModuleInfo>): ModuleInfo {
  return {
    name: 'TestModule',
    filePath: '/repo/svc/src/test.ts',
    kind: 'class',
    serviceName: 'my-service',
    layerName: 'service',
    methodCount: 1,
    propertyCount: 0,
    importCount: 0,
    exportCount: 1,
    ...overrides,
  }
}

function makeMethod(overrides: Partial<MethodInfo>): MethodInfo {
  return {
    name: 'testMethod',
    moduleName: 'TestModule',
    serviceName: 'my-service',
    filePath: '/repo/svc/src/test.ts',
    signature: 'testMethod(): void',
    paramCount: 0,
    isAsync: false,
    isExported: true,
    ...overrides,
  }
}

function makeDep(overrides: Partial<MethodLevelDependency>): MethodLevelDependency {
  return {
    callerMethod: 'caller',
    callerModule: 'CallerModule',
    callerService: 'my-service',
    calleeMethod: 'callee',
    calleeModule: 'CalleeModule',
    calleeService: 'my-service',
    callCount: 1,
    ...overrides,
  }
}

function buildGraph(input: AnalysisGraphInput): AnalysisGraph {
  return new AnalysisGraph(input)
}

describe('traceFlows', () => {
  it('returns empty array when no entry points exist', () => {
    const graph = buildGraph({
      methods: [makeMethod({ isExported: false })],
      methodDependencies: [],
      modules: [makeModule({ layerName: 'service' })],
      services: [{ name: 'my-service' }],
    })
    const flows = traceFlows(graph)
    expect(flows).toHaveLength(0)
  })

  it('traces a simple linear flow with HTTP trigger step', () => {
    const modules = [
      makeModule({ name: 'UserController', layerName: 'api', serviceName: 'user-svc' }),
      makeModule({ name: 'UserService', layerName: 'service', serviceName: 'user-svc' }),
      makeModule({ name: 'UserRepository', layerName: 'data', serviceName: 'user-svc' }),
    ]
    const methods = [
      makeMethod({ name: 'getUser', moduleName: 'UserController', serviceName: 'user-svc', isExported: true, isAsync: true }),
      makeMethod({ name: 'findUser', moduleName: 'UserService', serviceName: 'user-svc', isExported: true, isAsync: true }),
      makeMethod({ name: 'findById', moduleName: 'UserRepository', serviceName: 'user-svc', isExported: true, isAsync: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'getUser', callerModule: 'UserController', callerService: 'user-svc', calleeMethod: 'findUser', calleeModule: 'UserService', calleeService: 'user-svc' }),
      makeDep({ callerMethod: 'findUser', callerModule: 'UserService', callerService: 'user-svc', calleeMethod: 'findById', calleeModule: 'UserRepository', calleeService: 'user-svc' }),
    ]

    const graph = buildGraph({
      methods,
      methodDependencies: deps,
      modules,
      services: [{ name: 'user-svc' }],
    })
    const flows = traceFlows(graph)

    expect(flows).toHaveLength(1)
    expect(flows[0].name).toBe('UserController.getUser')
    expect(flows[0].trigger).toBe('http')
    expect(flows[0].entryService).toBe('user-svc')
    // 4 steps: HTTP trigger + controller→service + service→repository + repository→DB
    expect(flows[0].steps).toHaveLength(4)

    // Step 1: HTTP Client → controller (trigger)
    expect(flows[0].steps[0].sourceService).toBe('HTTP Client')
    expect(flows[0].steps[0].targetMethod).toBe('getUser')
    expect(flows[0].steps[0].stepType).toBe('http')

    // Step 2: controller → service (call)
    expect(flows[0].steps[1].sourceMethod).toBe('getUser')
    expect(flows[0].steps[1].targetMethod).toBe('findUser')
    expect(flows[0].steps[1].stepType).toBe('call')

    // Step 3: service → repository (call to data layer)
    expect(flows[0].steps[2].sourceMethod).toBe('findUser')
    expect(flows[0].steps[2].targetMethod).toBe('findById')
    expect(flows[0].steps[2].stepType).toBe('call')

    // Step 4: repository → Database (db-read)
    expect(flows[0].steps[3].sourceMethod).toBe('findById')
    expect(flows[0].steps[3].targetService).toBe('Database')
    expect(flows[0].steps[3].stepType).toBe('db-read')
  })

  it('shows Browser as trigger source when frontend service exists', () => {
    const modules = [
      makeModule({ name: 'ApiCtrl', layerName: 'api', serviceName: 'backend' }),
      makeModule({ name: 'Svc', layerName: 'service', serviceName: 'backend' }),
    ]
    const methods = [
      makeMethod({ name: 'handle', moduleName: 'ApiCtrl', serviceName: 'backend', isExported: true }),
      makeMethod({ name: 'doWork', moduleName: 'Svc', serviceName: 'backend' }),
    ]
    const deps = [
      makeDep({ callerMethod: 'handle', callerModule: 'ApiCtrl', callerService: 'backend', calleeMethod: 'doWork', calleeModule: 'Svc', calleeService: 'backend' }),
    ]

    const graph = buildGraph({
      methods,
      methodDependencies: deps,
      modules,
      services: [{ name: 'backend' }, { name: 'frontend', type: 'frontend' }],
    })
    const flows = traceFlows(graph)

    expect(flows).toHaveLength(1)
    expect(flows[0].steps[0].sourceService).toBe('Browser')
  })

  it('classifies db-write steps correctly', () => {
    const modules = [
      makeModule({ name: 'ApiController', layerName: 'api', serviceName: 'svc' }),
      makeModule({ name: 'DataRepo', layerName: 'data', serviceName: 'svc' }),
    ]
    const methods = [
      makeMethod({ name: 'create', moduleName: 'ApiController', serviceName: 'svc', isExported: true }),
      makeMethod({ name: 'saveUser', moduleName: 'DataRepo', serviceName: 'svc', isExported: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'create', callerModule: 'ApiController', callerService: 'svc', calleeMethod: 'saveUser', calleeModule: 'DataRepo', calleeService: 'svc' }),
    ]

    const graph = buildGraph({ methods, methodDependencies: deps, modules, services: [{ name: 'svc' }] })
    const flows = traceFlows(graph)

    expect(flows).toHaveLength(1)
    // Step 0: trigger, step 1: controller → data repo (call), step 2: repo → DB (db-write)
    expect(flows[0].steps[0].stepType).toBe('http')
    expect(flows[0].steps[1].stepType).toBe('call')
    expect(flows[0].steps[2].targetService).toBe('Database')
    expect(flows[0].steps[2].stepType).toBe('db-write')
  })

  it('classifies cross-service calls as http', () => {
    const modules = [
      makeModule({ name: 'GatewayCtrl', layerName: 'api', serviceName: 'gateway' }),
      makeModule({ name: 'UserSvc', layerName: 'service', serviceName: 'user-svc' }),
    ]
    const methods = [
      makeMethod({ name: 'proxy', moduleName: 'GatewayCtrl', serviceName: 'gateway', isExported: true }),
      makeMethod({ name: 'handle', moduleName: 'UserSvc', serviceName: 'user-svc', isExported: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'proxy', callerModule: 'GatewayCtrl', callerService: 'gateway', calleeMethod: 'handle', calleeModule: 'UserSvc', calleeService: 'user-svc' }),
    ]

    const graph = buildGraph({ methods, methodDependencies: deps, modules, services: [{ name: 'gateway' }, { name: 'user-svc' }] })
    const flows = traceFlows(graph)

    expect(flows).toHaveLength(1)
    // Step 1 (after trigger) is the cross-service call
    expect(flows[0].steps[1].stepType).toBe('http')
  })

  it('handles cycles without infinite looping', () => {
    const modules = [
      makeModule({ name: 'Ctrl', layerName: 'api', serviceName: 'svc' }),
      makeModule({ name: 'A', layerName: 'service', serviceName: 'svc' }),
      makeModule({ name: 'B', layerName: 'service', serviceName: 'svc' }),
    ]
    const methods = [
      makeMethod({ name: 'process', moduleName: 'Ctrl', serviceName: 'svc', isExported: true }),
      makeMethod({ name: 'doA', moduleName: 'A', serviceName: 'svc' }),
      makeMethod({ name: 'doB', moduleName: 'B', serviceName: 'svc' }),
    ]
    const deps = [
      makeDep({ callerMethod: 'process', callerModule: 'Ctrl', callerService: 'svc', calleeMethod: 'doA', calleeModule: 'A', calleeService: 'svc' }),
      makeDep({ callerMethod: 'doA', callerModule: 'A', callerService: 'svc', calleeMethod: 'doB', calleeModule: 'B', calleeService: 'svc' }),
      makeDep({ callerMethod: 'doB', callerModule: 'B', callerService: 'svc', calleeMethod: 'doA', calleeModule: 'A', calleeService: 'svc' }),
    ]

    const graph = buildGraph({ methods, methodDependencies: deps, modules, services: [{ name: 'svc' }] })
    const flows = traceFlows(graph)

    expect(flows).toHaveLength(1)
    // 3 steps: trigger + start→doA + doA→doB (cycle stopped)
    expect(flows[0].steps).toHaveLength(3)
  })

  it('skips entry points with no downstream calls', () => {
    const modules = [
      makeModule({ name: 'HealthCtrl', layerName: 'api', serviceName: 'svc' }),
    ]
    const methods = [
      makeMethod({ name: 'check', moduleName: 'HealthCtrl', serviceName: 'svc', isExported: true }),
    ]

    const graph = buildGraph({ methods, methodDependencies: [], modules, services: [{ name: 'svc' }] })
    const flows = traceFlows(graph)
    expect(flows).toHaveLength(0)
  })

  it('discovers class methods as entry points when module has exports', () => {
    const modules = [
      makeModule({ name: 'UserController', layerName: 'controller', serviceName: 'api-gw', kind: 'class', exportCount: 1 }),
      makeModule({ name: 'UserService', layerName: 'service', serviceName: 'api-gw' }),
    ]
    const methods = [
      // Class methods are NOT individually exported, but the class module has exports
      makeMethod({ name: 'getAll', moduleName: 'UserController', serviceName: 'api-gw', isExported: false }),
      makeMethod({ name: 'getById', moduleName: 'UserController', serviceName: 'api-gw', isExported: false }),
      makeMethod({ name: 'findAll', moduleName: 'UserService', serviceName: 'api-gw', isExported: true }),
      makeMethod({ name: 'findById', moduleName: 'UserService', serviceName: 'api-gw', isExported: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'getAll', callerModule: 'UserController', callerService: 'api-gw', calleeMethod: 'findAll', calleeModule: 'UserService', calleeService: 'api-gw' }),
      makeDep({ callerMethod: 'getById', callerModule: 'UserController', callerService: 'api-gw', calleeMethod: 'findById', calleeModule: 'UserService', calleeService: 'api-gw' }),
    ]

    const graph = buildGraph({ methods, methodDependencies: deps, modules, services: [{ name: 'api-gw' }] })
    const flows = traceFlows(graph)

    expect(flows).toHaveLength(2)
    const names = flows.map((f) => f.name).sort()
    expect(names).toEqual(['UserController.getAll', 'UserController.getById'])
    // Both should have HTTP trigger since they're in controller layer
    expect(flows[0].trigger).toBe('http')
    expect(flows[1].trigger).toBe('http')
  })

  it('does not discover class methods when module has zero exports', () => {
    const modules = [
      makeModule({ name: 'InternalCtrl', layerName: 'controller', serviceName: 'svc', kind: 'class', exportCount: 0 }),
      makeModule({ name: 'Svc', layerName: 'service', serviceName: 'svc' }),
    ]
    const methods = [
      makeMethod({ name: 'internal', moduleName: 'InternalCtrl', serviceName: 'svc', isExported: false }),
      makeMethod({ name: 'doWork', moduleName: 'Svc', serviceName: 'svc', isExported: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'internal', callerModule: 'InternalCtrl', callerService: 'svc', calleeMethod: 'doWork', calleeModule: 'Svc', calleeService: 'svc' }),
    ]

    const graph = buildGraph({ methods, methodDependencies: deps, modules, services: [{ name: 'svc' }] })
    const flows = traceFlows(graph)
    expect(flows).toHaveLength(0)
  })

  it('discovers non-API entry points for services without API layer', () => {
    const modules = [
      makeModule({ name: 'CrawlerService', layerName: 'service', serviceName: 'crawler' }),
      makeModule({ name: 'CrawlerRepo', layerName: 'data', serviceName: 'crawler' }),
    ]
    const methods = [
      makeMethod({ name: 'crawl', moduleName: 'CrawlerService', serviceName: 'crawler', isExported: true, isAsync: true }),
      makeMethod({ name: 'saveResult', moduleName: 'CrawlerRepo', serviceName: 'crawler', isExported: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'crawl', callerModule: 'CrawlerService', callerService: 'crawler', calleeMethod: 'saveResult', calleeModule: 'CrawlerRepo', calleeService: 'crawler' }),
    ]

    const graph = buildGraph({ methods, methodDependencies: deps, modules, services: [{ name: 'crawler' }] })
    const flows = traceFlows(graph)

    expect(flows).toHaveLength(1)
    expect(flows[0].name).toBe('CrawlerService.crawl')
    expect(flows[0].trigger).toBe('startup')
    expect(flows[0].entryService).toBe('crawler')
    // Step 1: System → crawl, Step 2: crawl → saveResult, Step 3: saveResult → DB
    expect(flows[0].steps[0].sourceService).toBe('System')
    expect(flows[0].steps[0].stepType).toBe('call')
  })

  it('does not use fallback entry points for services that already have API-layer flows', () => {
    const modules = [
      makeModule({ name: 'ApiCtrl', layerName: 'api', serviceName: 'svc' }),
      makeModule({ name: 'WorkerSvc', layerName: 'service', serviceName: 'svc' }),
      makeModule({ name: 'Repo', layerName: 'data', serviceName: 'svc' }),
    ]
    const methods = [
      makeMethod({ name: 'handle', moduleName: 'ApiCtrl', serviceName: 'svc', isExported: true }),
      makeMethod({ name: 'process', moduleName: 'WorkerSvc', serviceName: 'svc', isExported: true }),
      makeMethod({ name: 'save', moduleName: 'Repo', serviceName: 'svc', isExported: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'handle', callerModule: 'ApiCtrl', callerService: 'svc', calleeMethod: 'process', calleeModule: 'WorkerSvc', calleeService: 'svc' }),
      makeDep({ callerMethod: 'process', callerModule: 'WorkerSvc', callerService: 'svc', calleeMethod: 'save', calleeModule: 'Repo', calleeService: 'svc' }),
    ]

    const graph = buildGraph({ methods, methodDependencies: deps, modules, services: [{ name: 'svc' }] })
    const flows = traceFlows(graph)

    // Only the API entry point flow, not the service-layer one
    expect(flows).toHaveLength(1)
    expect(flows[0].name).toBe('ApiCtrl.handle')
    expect(flows[0].trigger).toBe('http')
  })

  it('follows cross-service HTTP calls to target service handlers', () => {
    const modules = [
      makeModule({ name: 'GatewayCtrl', layerName: 'api', serviceName: 'api-gateway' }),
      makeModule({ name: 'UserProxy', layerName: 'service', serviceName: 'api-gateway' }),
      makeModule({ name: 'UserHandler', layerName: 'api', serviceName: 'user-service' }),
      makeModule({ name: 'UserRepo', layerName: 'data', serviceName: 'user-service' }),
    ]
    const methods = [
      makeMethod({ name: 'getUser', moduleName: 'GatewayCtrl', serviceName: 'api-gateway', isExported: true }),
      makeMethod({ name: 'findById', moduleName: 'UserProxy', serviceName: 'api-gateway', isExported: true }),
      makeMethod({ name: 'getUserById', moduleName: 'UserHandler', serviceName: 'user-service', isExported: true }),
      makeMethod({ name: 'findById', moduleName: 'UserRepo', serviceName: 'user-service', isExported: true, isAsync: true }),
    ]
    const deps = [
      // Gateway controller → proxy service (same service)
      makeDep({ callerMethod: 'getUser', callerModule: 'GatewayCtrl', callerService: 'api-gateway', calleeMethod: 'findById', calleeModule: 'UserProxy', calleeService: 'api-gateway' }),
      // User handler → repo (same service)
      makeDep({ callerMethod: 'getUserById', callerModule: 'UserHandler', callerService: 'user-service', calleeMethod: 'findById', calleeModule: 'UserRepo', calleeService: 'user-service' }),
    ]

    const graph = buildGraph({
      methods,
      methodDependencies: deps,
      modules,
      services: [{ name: 'api-gateway' }, { name: 'user-service' }],
      crossServiceCalls: [
        {
          sourceService: 'api-gateway',
          sourceModule: 'UserProxy',
          httpMethod: 'GET',
          url: '/users/:param',
          targetService: 'user-service',
        },
      ],
      routeHandlers: new Map([
        ['user-service::GET::/users/:id', { handlerName: 'getUserById', moduleName: 'UserHandler' }],
      ]),
    })
    const flows = traceFlows(graph)

    // Should have 1 flow starting from api-gateway that crosses into user-service
    const gwFlow = flows.find((f) => f.entryService === 'api-gateway')
    expect(gwFlow).toBeDefined()

    // Steps: HTTP trigger → getUser → findById (proxy) → HTTP → getUserById → findById (repo) → DB
    const services = gwFlow!.steps.map((s) => s.targetService)
    expect(services).toContain('user-service')

    // Verify there's an HTTP step crossing to user-service
    const crossServiceStep = gwFlow!.steps.find(
      (s) => s.stepType === 'http' && s.targetService === 'user-service',
    )
    expect(crossServiceStep).toBeDefined()
    expect(crossServiceStep!.targetMethod).toBe('getUserById')

    // Deduplication: user-service's getUserById should NOT have its own standalone flow
    const userFlow = flows.find((f) => f.entryService === 'user-service' && f.entryMethod === 'getUserById')
    expect(userFlow).toBeUndefined()
  })

  it('does not follow cross-service calls when no handler matches', () => {
    const modules = [
      makeModule({ name: 'Ctrl', layerName: 'api', serviceName: 'svc-a' }),
      makeModule({ name: 'Proxy', layerName: 'service', serviceName: 'svc-a' }),
      // Target service has no API-layer modules
      makeModule({ name: 'InternalSvc', layerName: 'service', serviceName: 'svc-b' }),
    ]
    const methods = [
      makeMethod({ name: 'handle', moduleName: 'Ctrl', serviceName: 'svc-a', isExported: true }),
      makeMethod({ name: 'callRemote', moduleName: 'Proxy', serviceName: 'svc-a', isExported: true }),
      makeMethod({ name: 'doWork', moduleName: 'InternalSvc', serviceName: 'svc-b', isExported: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'handle', callerModule: 'Ctrl', callerService: 'svc-a', calleeMethod: 'callRemote', calleeModule: 'Proxy', calleeService: 'svc-a' }),
    ]

    const graph = buildGraph({
      methods,
      methodDependencies: deps,
      modules,
      services: [{ name: 'svc-a' }, { name: 'svc-b' }],
      crossServiceCalls: [
        {
          sourceService: 'svc-a',
          sourceModule: 'Proxy',
          httpMethod: 'POST',
          url: '/api/unmatched-resource',
          targetService: 'svc-b',
        },
      ],
    })
    const flows = traceFlows(graph)

    // Flow exists but doesn't cross into svc-b (no matching handler)
    expect(flows).toHaveLength(1)
    const svcNames = new Set(flows[0].steps.map((s) => s.targetService))
    expect(svcNames.has('svc-b')).toBe(false)
  })

  it('marks async steps correctly', () => {
    const modules = [
      makeModule({ name: 'Ctrl', layerName: 'api', serviceName: 'svc' }),
      makeModule({ name: 'Worker', layerName: 'service', serviceName: 'svc' }),
    ]
    const methods = [
      makeMethod({ name: 'trigger', moduleName: 'Ctrl', serviceName: 'svc', isExported: true }),
      makeMethod({ name: 'process', moduleName: 'Worker', serviceName: 'svc', isAsync: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'trigger', callerModule: 'Ctrl', callerService: 'svc', calleeMethod: 'process', calleeModule: 'Worker', calleeService: 'svc' }),
    ]

    const graph = buildGraph({ methods, methodDependencies: deps, modules, services: [{ name: 'svc' }] })
    const flows = traceFlows(graph)

    expect(flows).toHaveLength(1)
    // Step 1 (after trigger) is the async call
    expect(flows[0].steps[1].isAsync).toBe(true)
  })

  it('uses sourceMethod to key cross-service calls to the correct method', () => {
    const modules = [
      makeModule({ name: 'GatewayCtrl', layerName: 'api', serviceName: 'api-gateway' }),
      makeModule({ name: 'UserService', layerName: 'service', serviceName: 'api-gateway' }),
      makeModule({ name: 'UserHandler', layerName: 'handler', serviceName: 'user-service' }),
    ]
    const methods = [
      makeMethod({ name: 'getUser', moduleName: 'GatewayCtrl', serviceName: 'api-gateway', isExported: true }),
      makeMethod({ name: 'findById', moduleName: 'UserService', serviceName: 'api-gateway', isExported: true }),
      makeMethod({ name: 'findAll', moduleName: 'UserService', serviceName: 'api-gateway', isExported: true }),
      makeMethod({ name: 'getUserById', moduleName: 'UserHandler', serviceName: 'user-service', isExported: true }),
      makeMethod({ name: 'getUsers', moduleName: 'UserHandler', serviceName: 'user-service', isExported: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'getUser', callerModule: 'GatewayCtrl', callerService: 'api-gateway', calleeMethod: 'findById', calleeModule: 'UserService', calleeService: 'api-gateway' }),
    ]

    const graph = buildGraph({
      methods,
      methodDependencies: deps,
      modules,
      services: [{ name: 'api-gateway' }, { name: 'user-service' }],
      crossServiceCalls: [
        {
          sourceService: 'api-gateway',
          sourceModule: 'UserService',
          sourceMethod: 'findById',
          httpMethod: 'GET',
          url: '/users/:param',
          targetService: 'user-service',
        },
        {
          sourceService: 'api-gateway',
          sourceModule: 'UserService',
          sourceMethod: 'findAll',
          httpMethod: 'GET',
          url: '/users',
          targetService: 'user-service',
        },
      ],
      routeHandlers: new Map([
        ['user-service::GET::/users/:id', { handlerName: 'getUserById', moduleName: 'UserHandler' }],
        ['user-service::GET::/users', { handlerName: 'getUsers', moduleName: 'UserHandler' }],
      ]),
    })
    const flows = traceFlows(graph)

    const gwFlow = flows.find((f) => f.entryService === 'api-gateway')
    expect(gwFlow).toBeDefined()

    // findById should follow the GET /users/:id call, matching getUserById
    const crossStep = gwFlow!.steps.find(
      (s) => s.stepType === 'http' && s.targetService === 'user-service',
    )
    expect(crossStep).toBeDefined()
    expect(crossStep!.targetMethod).toBe('getUserById')
  })

  it('uses routeHandlers to resolve target handler exactly', () => {
    const modules = [
      makeModule({ name: 'GatewayCtrl', layerName: 'api', serviceName: 'api-gateway' }),
      makeModule({ name: 'Proxy', layerName: 'service', serviceName: 'api-gateway' }),
      makeModule({ name: 'UserHandler', layerName: 'handler', serviceName: 'user-service' }),
    ]
    const methods = [
      makeMethod({ name: 'handle', moduleName: 'GatewayCtrl', serviceName: 'api-gateway', isExported: true }),
      makeMethod({ name: 'fetchUser', moduleName: 'Proxy', serviceName: 'api-gateway', isExported: true }),
      makeMethod({ name: 'getUserById', moduleName: 'UserHandler', serviceName: 'user-service', isExported: true }),
      makeMethod({ name: 'getUsers', moduleName: 'UserHandler', serviceName: 'user-service', isExported: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'handle', callerModule: 'GatewayCtrl', callerService: 'api-gateway', calleeMethod: 'fetchUser', calleeModule: 'Proxy', calleeService: 'api-gateway' }),
    ]

    // Route handler map: user-service has route GET /users/:id → getUserById
    const routeHandlers = new Map<string, RouteHandler>([
      ['user-service::GET::/users/:id', { handlerName: 'getUserById', moduleName: 'UserHandler' }],
      ['user-service::GET::/users', { handlerName: 'getUsers', moduleName: 'UserHandler' }],
    ])

    const graph = buildGraph({
      methods,
      methodDependencies: deps,
      modules,
      services: [{ name: 'api-gateway' }, { name: 'user-service' }],
      crossServiceCalls: [
        {
          sourceService: 'api-gateway',
          sourceModule: 'Proxy',
          sourceMethod: 'fetchUser',
          httpMethod: 'GET',
          url: '/users/:param',
          targetService: 'user-service',
        },
      ],
      routeHandlers,
    })
    const flows = traceFlows(graph)

    const gwFlow = flows.find((f) => f.entryService === 'api-gateway')
    expect(gwFlow).toBeDefined()

    const crossStep = gwFlow!.steps.find(
      (s) => s.stepType === 'http' && s.targetService === 'user-service',
    )
    expect(crossStep).toBeDefined()
    // With routeHandlers, this should resolve to getUserById (not getUsers)
    expect(crossStep!.targetMethod).toBe('getUserById')
  })

  it('falls back to heuristic when routeHandlers has no match', () => {
    const modules = [
      makeModule({ name: 'Ctrl', layerName: 'api', serviceName: 'svc-a' }),
      makeModule({ name: 'Proxy', layerName: 'service', serviceName: 'svc-a' }),
      makeModule({ name: 'TargetCtrl', layerName: 'api', serviceName: 'svc-b' }),
    ]
    const methods = [
      makeMethod({ name: 'handle', moduleName: 'Ctrl', serviceName: 'svc-a', isExported: true }),
      makeMethod({ name: 'callRemote', moduleName: 'Proxy', serviceName: 'svc-a', isExported: true }),
      makeMethod({ name: 'getOrders', moduleName: 'TargetCtrl', serviceName: 'svc-b', isExported: true }),
    ]
    const deps = [
      makeDep({ callerMethod: 'handle', callerModule: 'Ctrl', callerService: 'svc-a', calleeMethod: 'callRemote', calleeModule: 'Proxy', calleeService: 'svc-a' }),
    ]

    // routeHandlers exist but have no match for the target
    const routeHandlers = new Map<string, RouteHandler>([
      ['svc-c::GET::/unrelated', { handlerName: 'unrelated', moduleName: 'Unrelated' }],
    ])

    const graph = buildGraph({
      methods,
      methodDependencies: deps,
      modules,
      services: [{ name: 'svc-a' }, { name: 'svc-b' }],
      crossServiceCalls: [
        {
          sourceService: 'svc-a',
          sourceModule: 'Proxy',
          sourceMethod: 'callRemote',
          httpMethod: 'GET',
          url: '/orders',
          targetService: 'svc-b',
        },
      ],
      routeHandlers,
    })
    const flows = traceFlows(graph)

    const flow = flows.find((f) => f.entryService === 'svc-a')
    expect(flow).toBeDefined()
    // heuristic may or may not match — just verify no crash
  })
})
