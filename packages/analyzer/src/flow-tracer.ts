import type {
  MethodInfo,
  MethodLevelDependency,
  ModuleInfo,
  FlowStepType,
  FlowTrigger,
} from '@truecourse/shared'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TracedFlowStep {
  stepOrder: number
  sourceService: string
  sourceModule: string
  sourceMethod: string
  targetService: string
  targetModule: string
  targetMethod: string
  stepType: FlowStepType
  isAsync: boolean
  isConditional: boolean
}

export interface TracedFlow {
  name: string
  entryService: string
  entryModule: string
  entryMethod: string
  category: string
  trigger: FlowTrigger
  steps: TracedFlowStep[]
}

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

export interface TraceFlowsInput {
  methods: MethodInfo[]
  methodDependencies: MethodLevelDependency[]
  modules: ModuleInfo[]
  services: { name: string; type?: string }[]
  crossServiceCalls?: CrossServiceCall[]
  databaseConnections?: { serviceName: string; databaseName: string; databaseType: string }[]
  routeHandlers?: Map<string, RouteHandler>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DB_WRITE_PATTERNS = /^(create|save|update|delete|remove|insert|upsert|destroy|drop|put|set|add|write|store|persist|modify|patch)/i
const DB_READ_PATTERNS = /^(get|find|fetch|load|read|list|query|search|count|select|lookup|retrieve|check|has|is|exists)/i

// HTTP method → likely handler method name prefixes
const HTTP_METHOD_PREFIXES: Record<string, string[]> = {
  GET: ['get', 'find', 'fetch', 'list', 'load', 'read', 'search', 'query'],
  POST: ['create', 'add', 'insert', 'save', 'register', 'post'],
  PUT: ['update', 'put', 'replace', 'set', 'modify'],
  PATCH: ['update', 'patch', 'modify'],
  DELETE: ['delete', 'remove', 'destroy', 'drop'],
}

/**
 * Extract the primary resource name from a normalized URL path.
 * Expects pre-normalized URLs (language-specific interpolation already removed).
 * e.g., "/users/:param" → "user"
 *       "/api/v1/orders/:param/items" → "order"
 */
function extractResourceFromUrl(url: string): string | null {
  // Get meaningful path segments (skip empty, 'api', version segments, and params)
  const segments = url.split('/').filter((s) =>
    s && s !== 'api' && !/^v\d+$/i.test(s) && !s.startsWith(':'),
  )

  if (segments.length === 0) return null

  // Take the first resource segment and singularize naively
  const resource = segments[0].toLowerCase()
  return resource.endsWith('s') && resource.length > 2
    ? resource.slice(0, -1)
    : resource
}

/**
 * Match a caller method name to the most likely HTTP call from a set of calls.
 * Uses HTTP method prefix heuristics: findById → GET, create → POST, etc.
 * Returns null if no call matches or if there's only one call (use it directly).
 */
function matchCallerToHttpCall(
  callerMethod: string,
  calls: CrossServiceCall[],
): CrossServiceCall | null {
  if (calls.length === 0) return null
  if (calls.length === 1) return calls[0]

  const methodLower = callerMethod.toLowerCase()

  // Determine which HTTP method the caller likely uses based on its name
  let expectedHttpMethod: string | null = null
  for (const [httpMethod, prefixes] of Object.entries(HTTP_METHOD_PREFIXES)) {
    for (const prefix of prefixes) {
      if (methodLower.startsWith(prefix)) {
        expectedHttpMethod = httpMethod
        break
      }
    }
    if (expectedHttpMethod) break
  }

  if (!expectedHttpMethod) return null

  // Find calls matching the expected HTTP method
  const matching = calls.filter((c) => c.httpMethod === expectedHttpMethod)
  if (matching.length === 1) return matching[0]
  if (matching.length === 0) return null

  // Multiple calls with same HTTP method — distinguish by URL shape
  // Methods like findById/getOne/deleteById expect a parameterized URL (/users/:id)
  // Methods like findAll/getAll/list expect a collection URL (/users)
  const singularPatterns = /byid|one|single|byname|byemail|byslug|specific/i
  const pluralPatterns = /all|list|many|multiple|every|batch/i
  const expectsParam = singularPatterns.test(callerMethod)
  const expectsList = pluralPatterns.test(callerMethod)

  if (expectsParam || expectsList) {
    const hasParam = (url: string) => /:[a-z]/i.test(url)
    for (const call of matching) {
      if (expectsParam && hasParam(call.url)) return call
      if (expectsList && !hasParam(call.url)) return call
    }
  }

  return matching[0]
}

/**
 * Try to find the best matching API-layer method in the target service
 * for a given HTTP call (method + URL).
 */
function matchHttpCallToHandler(
  httpMethod: string,
  url: string,
  targetService: string,
  apiMethodsByService: Map<string, { method: MethodInfo; module: ModuleInfo }[]>,
): { method: MethodInfo; module: ModuleInfo } | null {
  const candidates = apiMethodsByService.get(targetService)
  if (!candidates || candidates.length === 0) return null

  const resource = extractResourceFromUrl(url)
  const prefixes = HTTP_METHOD_PREFIXES[httpMethod] || []

  // Score each candidate
  let bestMatch: { method: MethodInfo; module: ModuleInfo } | null = null
  let bestScore = 0

  for (const candidate of candidates) {
    let score = 0
    const methodLower = candidate.method.name.toLowerCase()
    const moduleLower = candidate.module.name.toLowerCase()

    // Module name contains the resource? (e.g., "UserController" matches resource "user")
    if (resource && moduleLower.includes(resource)) {
      score += 10
    }

    // Method name starts with an expected prefix for this HTTP method?
    for (const prefix of prefixes) {
      if (methodLower.startsWith(prefix)) {
        score += 5
        break
      }
    }

    // Method name contains the resource?
    if (resource && methodLower.includes(resource)) {
      score += 3
    }

    // URL shape matching: parameterized URLs favor "ById" methods, plain URLs favor "All/List"
    const urlHasParam = /:[a-z]/i.test(url)
    if (urlHasParam && /byid|one|single/i.test(methodLower)) {
      score += 4
    } else if (!urlHasParam && /all|list|many|getusers|gets\b/i.test(methodLower)) {
      score += 4
    }

    if (score > bestScore) {
      bestScore = score
      bestMatch = candidate
    }
  }

  // Require at least a module match (score >= 10) to avoid false positives
  return bestScore >= 10 ? bestMatch : null
}

/**
 * Match a normalized URL pattern against a route pattern.
 * Supports :param segments matching any segment.
 */
function matchRoutePattern(urlPattern: string, routePattern: string): boolean {
  const urlParts = urlPattern.split('/').filter(Boolean)
  const routeParts = routePattern.split('/').filter(Boolean)

  if (urlParts.length !== routeParts.length) return false

  for (let i = 0; i < urlParts.length; i++) {
    const u = urlParts[i]
    const r = routeParts[i]
    // Either side being a param matches anything
    if (u.startsWith(':') || r.startsWith(':')) continue
    if (u !== r) return false
  }
  return true
}

const MAX_DEPTH = 20

function classifyTrigger(module: ModuleInfo | undefined): FlowTrigger {
  if (!module) return 'http'
  const layer = module.layerName.toLowerCase()
  if (layer === 'api' || layer === 'controller' || layer === 'route') return 'http'
  if (layer === 'event' || layer === 'listener' || layer === 'subscriber') return 'event'
  if (layer === 'service' || layer === 'worker' || layer === 'job' || layer === 'handler') return 'startup'
  return 'http'
}

function classifyStepType(
  callerService: string,
  calleeService: string,
  calleeModule: string,
  calleeMethod: string,
  dataLayerModules: Set<string>,
  libraryServices: Set<string>,
): FlowStepType {
  // Cross-service call → HTTP, unless the target is a shared library package
  if (callerService !== calleeService) {
    if (libraryServices.has(calleeService)) return 'call'
    return 'http'
  }

  // Only classify as db-read/db-write if target is actually in the data layer
  const moduleKey = `${calleeService}::${calleeModule}`
  if (dataLayerModules.has(moduleKey)) {
    if (DB_WRITE_PATTERNS.test(calleeMethod)) return 'db-write'
    return 'db-read'
  }

  return 'call'
}

function classifyCategory(module: ModuleInfo | undefined, methodName: string): string {
  if (!module) return 'general'
  const layer = module.layerName.toLowerCase()
  if (layer === 'api' || layer === 'controller') return 'api'
  if (layer === 'service') return 'service'
  if (layer === 'data') return 'data'
  return 'general'
}

// ---------------------------------------------------------------------------
// Core algorithm
// ---------------------------------------------------------------------------

export function traceFlows(input: TraceFlowsInput): TracedFlow[] {
  const { methods, methodDependencies, modules, services, crossServiceCalls, databaseConnections, routeHandlers } = input

  // Build lookup maps
  const moduleByName = new Map<string, ModuleInfo>()
  for (const m of modules) {
    moduleByName.set(`${m.serviceName}::${m.name}`, m)
  }

  const methodByKey = new Map<string, MethodInfo>()
  for (const m of methods) {
    methodByKey.set(`${m.serviceName}::${m.moduleName}::${m.name}`, m)
  }

  // Build adjacency list: caller → callees
  const adjacency = new Map<string, MethodLevelDependency[]>()
  for (const dep of methodDependencies) {
    const key = `${dep.callerService}::${dep.callerModule}::${dep.callerMethod}`
    if (!adjacency.has(key)) adjacency.set(key, [])
    adjacency.get(key)!.push(dep)
  }

  // Identify data-layer modules
  const dataLayerModules = new Set<string>()
  for (const m of modules) {
    if (m.layerName.toLowerCase() === 'data') {
      dataLayerModules.add(`${m.serviceName}::${m.name}`)
    }
  }

  // Identify library services (shared packages, not actual HTTP services)
  const libraryServices = new Set<string>()
  for (const s of services) {
    if (s.type === 'library') libraryServices.add(s.name)
  }

  // Map service → database info (prefer non-cache DBs)
  const serviceDbMap = new Map<string, { name: string; type: string }>()
  if (databaseConnections) {
    // First pass: non-cache databases
    for (const conn of databaseConnections) {
      if (conn.databaseType !== 'redis' && !serviceDbMap.has(conn.serviceName)) {
        serviceDbMap.set(conn.serviceName, { name: conn.databaseName, type: conn.databaseType })
      }
    }
    // Second pass: cache databases (only if no primary DB found)
    for (const conn of databaseConnections) {
      if (!serviceDbMap.has(conn.serviceName)) {
        serviceDbMap.set(conn.serviceName, { name: conn.databaseName, type: conn.databaseType })
      }
    }
  }

  // Build cross-service call maps:
  // - By method (exact): sourceService::sourceModule::sourceMethod → call
  // - By module (fallback): sourceService::sourceModule → calls[]
  const crossServiceCallsByMethod = new Map<string, CrossServiceCall>()
  const crossServiceCallsByModule = new Map<string, CrossServiceCall[]>()
  if (crossServiceCalls) {
    for (const call of crossServiceCalls) {
      if (call.sourceMethod) {
        const methodKey = `${call.sourceService}::${call.sourceModule}::${call.sourceMethod}`
        crossServiceCallsByMethod.set(methodKey, call)
      }
      const moduleKey = `${call.sourceService}::${call.sourceModule}`
      if (!crossServiceCallsByModule.has(moduleKey)) crossServiceCallsByModule.set(moduleKey, [])
      crossServiceCallsByModule.get(moduleKey)!.push(call)
    }
  }

  // Build API-layer methods by service for cross-service handler matching
  const apiMethodsByService = new Map<string, { method: MethodInfo; module: ModuleInfo }[]>()
  const apiLayers = new Set(['api', 'controller', 'route', 'handler'])
  for (const method of methods) {
    const mod = moduleByName.get(`${method.serviceName}::${method.moduleName}`)
    if (!mod) continue
    if (!apiLayers.has(mod.layerName.toLowerCase())) continue
    if (!apiMethodsByService.has(method.serviceName)) apiMethodsByService.set(method.serviceName, [])
    apiMethodsByService.get(method.serviceName)!.push({ method, module: mod })
  }

  // Find entry points: exported methods in API-layer modules
  const entryPoints: { method: MethodInfo; module: ModuleInfo }[] = []
  const servicesWithEntryPoints = new Set<string>()
  for (const method of methods) {
    const mod = moduleByName.get(`${method.serviceName}::${method.moduleName}`)
    if (!mod) continue
    const layer = mod.layerName.toLowerCase()
    if (layer !== 'api' && layer !== 'controller' && layer !== 'route') continue

    if (!method.isExported) {
      // Fix 2: Include class methods if the class module itself has exports
      if (mod.kind !== 'class' || mod.exportCount === 0) continue
    }

    entryPoints.push({ method, module: mod })
    servicesWithEntryPoints.add(method.serviceName)
  }

  // Fix 3: For services with zero API-layer entry points, consider exported methods
  // in service/worker/job/event/handler layers as entry points
  const fallbackLayers = new Set(['service', 'worker', 'job', 'event', 'handler'])
  for (const method of methods) {
    if (servicesWithEntryPoints.has(method.serviceName)) continue
    if (!method.isExported) continue
    const mod = moduleByName.get(`${method.serviceName}::${method.moduleName}`)
    if (!mod) continue
    const layer = mod.layerName.toLowerCase()
    if (!fallbackLayers.has(layer)) continue
    entryPoints.push({ method, module: mod })
    servicesWithEntryPoints.add(method.serviceName)
  }

  /**
   * Resolve the target handler for a cross-service HTTP call.
   * Tries routeHandlers lookup first, falls back to heuristic scoring.
   */
  function resolveTargetHandler(
    call: CrossServiceCall,
  ): { method: MethodInfo; module: ModuleInfo } | null {
    if (routeHandlers) {
      // URLs are already normalized upstream (language-specific interpolation removed)
      const normalizedPath = call.url
      // Try exact match first
      const exactKey = `${call.targetService}::${call.httpMethod}::${normalizedPath}`
      const handler = routeHandlers.get(exactKey)
      if (handler) {
        const methodKey = `${call.targetService}::${handler.moduleName}::${handler.handlerName}`
        const methodInfo = methodByKey.get(methodKey)
        const moduleInfo = moduleByName.get(`${call.targetService}::${handler.moduleName}`)
        if (methodInfo && moduleInfo) return { method: methodInfo, module: moduleInfo }
      }

      // Try pattern matching: iterate routeHandlers for the target service
      for (const [key, rh] of routeHandlers) {
        if (!key.startsWith(`${call.targetService}::${call.httpMethod}::`)) continue
        const routePath = key.slice(`${call.targetService}::${call.httpMethod}::`.length)
        if (matchRoutePattern(normalizedPath, routePath)) {
          const methodKey = `${call.targetService}::${rh.moduleName}::${rh.handlerName}`
          const methodInfo = methodByKey.get(methodKey)
          const moduleInfo = moduleByName.get(`${call.targetService}::${rh.moduleName}`)
          if (methodInfo && moduleInfo) return { method: methodInfo, module: moduleInfo }
        }
      }
    }
    // Fall back to heuristic scoring
    return matchHttpCallToHandler(call.httpMethod, call.url, call.targetService, apiMethodsByService)
  }

  const flows: TracedFlow[] = []

  for (const { method: entryMethod, module: entryModule } of entryPoints) {
    const steps: TracedFlowStep[] = []
    const visited = new Set<string>()
    let stepOrder = 0

    function dfs(
      callerService: string,
      callerModule: string,
      callerMethod: string,
      depth: number,
    ) {
      if (depth >= MAX_DEPTH) return

      const key = `${callerService}::${callerModule}::${callerMethod}`
      if (visited.has(key)) return
      visited.add(key)

      const deps = adjacency.get(key) || []
      for (const dep of deps) {
        const calleeKey = `${dep.calleeService}::${dep.calleeModule}::${dep.calleeMethod}`
        if (visited.has(calleeKey)) continue

        const calleeMethodInfo = methodByKey.get(calleeKey)

        const stepType = classifyStepType(
          callerService,
          dep.calleeService,
          dep.calleeModule,
          dep.calleeMethod,
          dataLayerModules,
          libraryServices,
        )

        stepOrder++
        steps.push({
          stepOrder,
          sourceService: callerService,
          sourceModule: callerModule,
          sourceMethod: callerMethod,
          targetService: dep.calleeService,
          targetModule: dep.calleeModule,
          targetMethod: dep.calleeMethod,
          stepType: (stepType === 'db-read' || stepType === 'db-write') ? 'call' : stepType,
          isAsync: calleeMethodInfo?.isAsync ?? false,
          isConditional: false,
        })

        // Append a synthetic DB step after data-layer calls
        if (stepType === 'db-read' || stepType === 'db-write') {
          const dbInfo = serviceDbMap.get(dep.calleeService)
          const dbName = dbInfo?.name || 'Database'
          const dbType = dbInfo?.type || 'unknown'
          stepOrder++
          steps.push({
            stepOrder,
            sourceService: dep.calleeService,
            sourceModule: dep.calleeModule,
            sourceMethod: dep.calleeMethod,
            targetService: dbName,
            targetModule: dbType,
            targetMethod: stepType === 'db-write' ? 'write' : 'query',
            stepType,
            isAsync: true,
            isConditional: false,
          })
        }

        dfs(dep.calleeService, dep.calleeModule, dep.calleeMethod, depth + 1)
      }

      // Follow cross-service HTTP calls from this method
      // Try method-level exact match first, fall back to module-level heuristic
      const methodCallKey = `${callerService}::${callerModule}::${callerMethod}`
      const exactCall = crossServiceCallsByMethod.get(methodCallKey)

      let bestCall: CrossServiceCall | null = null
      if (exactCall) {
        bestCall = exactCall
      } else {
        const moduleCallKey = `${callerService}::${callerModule}`
        const httpCalls = crossServiceCallsByModule.get(moduleCallKey)
        if (httpCalls) {
          bestCall = matchCallerToHttpCall(callerMethod, httpCalls)
        }
      }

      if (bestCall) {
        const handler = resolveTargetHandler(bestCall)
        if (handler) {
          const handlerKey = `${handler.method.serviceName}::${handler.method.moduleName}::${handler.method.name}`
          if (!visited.has(handlerKey)) {
            // Add HTTP step: caller → target handler
            stepOrder++
            steps.push({
              stepOrder,
              sourceService: callerService,
              sourceModule: callerModule,
              sourceMethod: callerMethod,
              targetService: handler.method.serviceName,
              targetModule: handler.method.moduleName,
              targetMethod: handler.method.name,
              stepType: 'http',
              isAsync: true,
              isConditional: false,
            })

            // Continue tracing into the target service
            dfs(handler.method.serviceName, handler.method.moduleName, handler.method.name, depth + 1)
          }
        }
      }
    }

    dfs(entryMethod.serviceName, entryMethod.moduleName, entryMethod.name, 0)

    // Only create flows that have at least one step
    if (steps.length === 0) continue

    const trigger = classifyTrigger(entryModule)
    const category = classifyCategory(entryModule, entryMethod.name)
    const name = `${entryModule.name}.${entryMethod.name}`

    // Prepend a synthetic first step showing the trigger source
    if (trigger === 'http') {
      const hasFrontend = services.some((s) => s.type === 'frontend')
      const triggerSource = hasFrontend ? 'Browser' : 'HTTP Client'
      // Shift existing step orders
      for (const s of steps) s.stepOrder++
      steps.unshift({
        stepOrder: 1,
        sourceService: triggerSource,
        sourceModule: triggerSource,
        sourceMethod: 'request',
        targetService: entryMethod.serviceName,
        targetModule: entryMethod.moduleName,
        targetMethod: entryMethod.name,
        stepType: 'http',
        isAsync: false,
        isConditional: false,
      })
    } else if (trigger === 'event') {
      for (const s of steps) s.stepOrder++
      steps.unshift({
        stepOrder: 1,
        sourceService: 'Event Bus',
        sourceModule: 'Event Bus',
        sourceMethod: 'emit',
        targetService: entryMethod.serviceName,
        targetModule: entryMethod.moduleName,
        targetMethod: entryMethod.name,
        stepType: 'event',
        isAsync: true,
        isConditional: false,
      })
    } else if (trigger === 'startup') {
      for (const s of steps) s.stepOrder++
      steps.unshift({
        stepOrder: 1,
        sourceService: 'System',
        sourceModule: 'System',
        sourceMethod: 'start',
        targetService: entryMethod.serviceName,
        targetModule: entryMethod.moduleName,
        targetMethod: entryMethod.name,
        stepType: 'call',
        isAsync: false,
        isConditional: false,
      })
    }

    flows.push({
      name,
      entryService: entryMethod.serviceName,
      entryModule: entryMethod.moduleName,
      entryMethod: entryMethod.name,
      category,
      trigger,
      steps,
    })
  }

  // Deduplicate: remove flows whose entry point is already reached as a
  // cross-service HTTP step in another flow. These are sub-flows that are
  // fully covered by a parent cross-service flow.
  if (crossServiceCalls && crossServiceCalls.length > 0) {
    const reachedViaHttp = new Set<string>()
    for (const flow of flows) {
      for (const step of flow.steps) {
        if (step.stepType === 'http' && step.targetService !== flow.entryService) {
          reachedViaHttp.add(`${step.targetService}::${step.targetModule}::${step.targetMethod}`)
        }
      }
    }

    return flows.filter((flow) => {
      const key = `${flow.entryService}::${flow.entryModule}::${flow.entryMethod}`
      return !reachedViaHttp.has(key)
    })
  }

  return flows
}
