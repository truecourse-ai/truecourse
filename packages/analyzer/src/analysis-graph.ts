import type {
  MethodInfo,
  MethodLevelDependency,
  ModuleInfo,
  FlowStepType,
} from '@truecourse/shared'

// ---------------------------------------------------------------------------
// Types (moved from flow-tracer.ts)
// ---------------------------------------------------------------------------

export interface CrossServiceCall {
  sourceService: string
  sourceModule: string
  sourceMethod?: string
  httpMethod: string
  url: string
  targetService: string
}

export interface RouteHandler {
  handlerName: string
  moduleName: string
}

export interface AnalysisGraphInput {
  methods: MethodInfo[]
  methodDependencies: MethodLevelDependency[]
  modules: ModuleInfo[]
  services: { name: string; type?: string }[]
  crossServiceCalls?: CrossServiceCall[]
  databaseConnections?: { serviceName: string; databaseName: string; databaseType: string }[]
  routeHandlers?: Map<string, RouteHandler>
}

// ---------------------------------------------------------------------------
// extractResource helper
// ---------------------------------------------------------------------------

export function extractResource(url: string): string | null {
  const segments = url.split('/').filter((s) => s && s !== 'api' && !/^v\d+$/i.test(s) && !s.startsWith(':'))
  if (segments.length === 0) return null
  const r = segments[0].toLowerCase()
  return r.endsWith('s') && r.length > 2 ? r.slice(0, -1) : r
}

// ---------------------------------------------------------------------------
// AnalysisGraph
// ---------------------------------------------------------------------------

export class AnalysisGraph {
  // Node lookups
  readonly moduleByKey: Map<string, ModuleInfo> // service::module → ModuleInfo
  readonly methodByKey: Map<string, MethodInfo> // service::module::method → MethodInfo

  // Adjacency (method-level)
  readonly adjacency: Map<string, MethodLevelDependency[]> // caller key → deps

  // Classification
  readonly dataLayerModules: Set<string> // service::module keys in data layer
  readonly libraryServices: Set<string> // services typed 'library'
  readonly apiMethodsByService: Map<string, { method: MethodInfo; module: ModuleInfo }[]>

  // Cross-service
  readonly crossServiceCallsByMethod: Map<string, CrossServiceCall>
  readonly crossServiceCallsByModule: Map<string, CrossServiceCall[]>
  readonly routeHandlers: Map<string, RouteHandler>

  // Databases
  readonly serviceDbMap: Map<string, { name: string; type: string }>

  // Services
  readonly services: { name: string; type?: string }[]
  readonly hasFrontend: boolean

  // Entry points
  readonly entryPoints: { method: MethodInfo; module: ModuleInfo }[]

  constructor(input: AnalysisGraphInput) {
    this.services = input.services
    this.hasFrontend = input.services.some((s) => s.type === 'frontend')

    // Module lookup
    this.moduleByKey = new Map()
    for (const m of input.modules) {
      this.moduleByKey.set(`${m.serviceName}::${m.name}`, m)
    }

    // Method lookup
    this.methodByKey = new Map()
    for (const m of input.methods) {
      this.methodByKey.set(`${m.serviceName}::${m.moduleName}::${m.name}`, m)
    }

    // Adjacency
    this.adjacency = new Map()
    for (const dep of input.methodDependencies) {
      const key = `${dep.callerService}::${dep.callerModule}::${dep.callerMethod}`
      if (!this.adjacency.has(key)) this.adjacency.set(key, [])
      this.adjacency.get(key)!.push(dep)
    }

    // Data layer modules
    this.dataLayerModules = new Set()
    for (const m of input.modules) {
      if (m.layerName.toLowerCase() === 'data') {
        this.dataLayerModules.add(`${m.serviceName}::${m.name}`)
      }
    }

    // Library services
    this.libraryServices = new Set()
    for (const s of input.services) {
      if (s.type === 'library') this.libraryServices.add(s.name)
    }

    // API-layer methods
    this.apiMethodsByService = new Map()
    const apiLayers = new Set(['api', 'controller', 'route', 'handler'])
    for (const method of input.methods) {
      const mod = this.moduleByKey.get(`${method.serviceName}::${method.moduleName}`)
      if (!mod || !apiLayers.has(mod.layerName.toLowerCase())) continue
      if (!this.apiMethodsByService.has(method.serviceName)) this.apiMethodsByService.set(method.serviceName, [])
      this.apiMethodsByService.get(method.serviceName)!.push({ method, module: mod })
    }

    // Cross-service calls from pre-built data
    this.crossServiceCallsByMethod = new Map()
    this.crossServiceCallsByModule = new Map()
    if (input.crossServiceCalls) {
      for (const call of input.crossServiceCalls) {
        if (call.sourceMethod) {
          this.crossServiceCallsByMethod.set(`${call.sourceService}::${call.sourceModule}::${call.sourceMethod}`, call)
        }
        const modKey = `${call.sourceService}::${call.sourceModule}`
        if (!this.crossServiceCallsByModule.has(modKey)) this.crossServiceCallsByModule.set(modKey, [])
        this.crossServiceCallsByModule.get(modKey)!.push(call)
      }
    }

    // Route handlers
    this.routeHandlers = input.routeHandlers || new Map()

    // Database info
    this.serviceDbMap = new Map()
    if (input.databaseConnections) {
      // First pass: non-cache databases
      for (const conn of input.databaseConnections) {
        if (conn.databaseType !== 'redis' && !this.serviceDbMap.has(conn.serviceName)) {
          this.serviceDbMap.set(conn.serviceName, { name: conn.databaseName, type: conn.databaseType })
        }
      }
      // Second pass: cache databases (only if no primary DB found)
      for (const conn of input.databaseConnections) {
        if (!this.serviceDbMap.has(conn.serviceName)) {
          this.serviceDbMap.set(conn.serviceName, { name: conn.databaseName, type: conn.databaseType })
        }
      }
    }

    // Entry points
    this.entryPoints = []
    const servicesWithEntryPoints = new Set<string>()
    for (const method of input.methods) {
      const mod = this.moduleByKey.get(`${method.serviceName}::${method.moduleName}`)
      if (!mod) continue
      const layer = mod.layerName.toLowerCase()
      if (layer !== 'api' && layer !== 'controller' && layer !== 'route') continue
      if (!method.isExported && (mod.kind !== 'class' || mod.exportCount === 0)) continue
      this.entryPoints.push({ method, module: mod })
      servicesWithEntryPoints.add(method.serviceName)
    }
    const fallbackLayers = new Set(['service', 'worker', 'job', 'event', 'handler'])
    for (const method of input.methods) {
      if (servicesWithEntryPoints.has(method.serviceName)) continue
      if (!method.isExported) continue
      const mod = this.moduleByKey.get(`${method.serviceName}::${method.moduleName}`)
      if (!mod) continue
      if (!fallbackLayers.has(mod.layerName.toLowerCase())) continue
      this.entryPoints.push({ method, module: mod })
      servicesWithEntryPoints.add(method.serviceName)
    }
  }

  /** Classify a step between two methods */
  classifyStep(callerService: string, calleeService: string, calleeModule: string, calleeMethod: string): FlowStepType {
    if (callerService !== calleeService) {
      if (this.libraryServices.has(calleeService)) return 'call'
      return 'http'
    }
    const moduleKey = `${calleeService}::${calleeModule}`
    if (this.dataLayerModules.has(moduleKey)) {
      const DB_WRITE = /^(create|save|update|delete|remove|insert|upsert|destroy|drop|put|set|add|write|store|persist|modify|patch)/i
      return DB_WRITE.test(calleeMethod) ? 'db-write' : 'db-read'
    }
    return 'call'
  }

  /** Get the cross-service call for a method (exact match first, then heuristic) */
  getCrossServiceCall(service: string, module: string, method: string): CrossServiceCall | null {
    const exact = this.crossServiceCallsByMethod.get(`${service}::${module}::${method}`)
    if (exact) return exact

    const moduleCalls = this.crossServiceCallsByModule.get(`${service}::${module}`)
    if (!moduleCalls || moduleCalls.length === 0) return null
    if (moduleCalls.length === 1) return moduleCalls[0]

    // Heuristic: match by HTTP method prefix
    const HTTP_PREFIXES: Record<string, string[]> = {
      GET: ['get', 'find', 'fetch', 'list', 'load', 'read', 'search', 'query'],
      POST: ['create', 'add', 'insert', 'save', 'register', 'post'],
      PUT: ['update', 'put', 'replace', 'set', 'modify'],
      PATCH: ['update', 'patch', 'modify'],
      DELETE: ['delete', 'remove', 'destroy', 'drop'],
    }
    const lower = method.toLowerCase()
    let expectedHttp: string | null = null
    for (const [httpMethod, prefixes] of Object.entries(HTTP_PREFIXES)) {
      if (prefixes.some((p) => lower.startsWith(p))) { expectedHttp = httpMethod; break }
    }
    if (!expectedHttp) return null

    const matching = moduleCalls.filter((c) => c.httpMethod === expectedHttp)
    if (matching.length === 1) return matching[0]
    if (matching.length === 0) return null

    const singularP = /byid|one|single|byname|byemail|byslug|specific/i
    const pluralP = /all|list|many|multiple|every|batch/i
    if (singularP.test(method) || pluralP.test(method)) {
      const hasParam = (url: string) => /:[a-z]/i.test(url)
      for (const call of matching) {
        if (singularP.test(method) && hasParam(call.url)) return call
        if (pluralP.test(method) && !hasParam(call.url)) return call
      }
    }
    return matching[0]
  }

  /** Resolve which handler in the target service receives an HTTP call */
  resolveHandler(call: CrossServiceCall): { method: MethodInfo; module: ModuleInfo } | null {
    if (this.routeHandlers.size === 0) return null

    const normalizedPath = call.url

    // Collect matching handlers: exact match first, then pattern match
    const matched = this.findMatchingRouteHandler(call.targetService, call.httpMethod, normalizedPath)
    if (!matched) return null

    return this.lookupHandlerMethod(call.targetService, matched)
  }

  private findMatchingRouteHandler(
    targetService: string,
    httpMethod: string,
    normalizedPath: string,
  ): RouteHandler | null {
    // Exact match
    const exactKey = `${targetService}::${httpMethod}::${normalizedPath}`
    const exact = this.routeHandlers.get(exactKey)
    if (exact) return exact

    // Pattern match (handles :param, <param>, {param}, [param])
    for (const [key, rh] of this.routeHandlers) {
      if (!key.startsWith(`${targetService}::${httpMethod}::`)) continue
      const routePath = key.slice(`${targetService}::${httpMethod}::`.length)
      if (matchRoutePattern(normalizedPath, routePath)) return rh
    }

    return null
  }

  private lookupHandlerMethod(
    targetService: string,
    handler: RouteHandler,
  ): { method: MethodInfo; module: ModuleInfo } | null {
    // Direct lookup: service::module::method
    const m = this.methodByKey.get(`${targetService}::${handler.moduleName}::${handler.handlerName}`)
    const mod = this.moduleByKey.get(`${targetService}::${handler.moduleName}`)
    if (m && mod) return { method: m, module: mod }

    // The handler's module name may not match the module registry (e.g., thin router
    // files that don't produce modules). Search all modules in the target service
    // for a method with the handler's name.
    for (const [key, method] of this.methodByKey) {
      if (!key.startsWith(`${targetService}::`) || !key.endsWith(`::${handler.handlerName}`)) continue
      const moduleName = key.split('::')[1]
      const module = this.moduleByKey.get(`${targetService}::${moduleName}`)
      if (module) return { method, module }
    }

    return null
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function matchRoutePattern(urlPattern: string, routePattern: string): boolean {
  const urlParts = urlPattern.split('/').filter(Boolean)
  const routeParts = routePattern.split('/').filter(Boolean)

  if (urlParts.length !== routeParts.length) return false

  for (let i = 0; i < urlParts.length; i++) {
    const u = urlParts[i]
    const r = routeParts[i]
    // Treat :param, <param>, {param}, [param] all as route parameter wildcards
    if (isRouteParam(u) || isRouteParam(r)) continue
    if (u !== r) return false
  }
  return true
}

function isRouteParam(segment: string): boolean {
  return segment.startsWith(':')       // Express: :id
    || segment.startsWith('<')         // Flask: <id>
    || segment.startsWith('{')         // FastAPI/C#: {id}
    || segment.startsWith('[')         // Next.js: [id]
}
