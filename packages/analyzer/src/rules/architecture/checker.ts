import type { ServiceInfo, ServiceDependencyInfo, ModuleInfo, MethodInfo, ModuleDependency, ModuleLevelDependency, MethodLevelDependency, AnalysisRule, FileAnalysis } from '@truecourse/shared'
import { getMaxParameters } from '../../language-config.js'
import { findCycles, type EdgeMetadata } from './tarjan.js'

// ---------------------------------------------------------------------------
// Violation types
// ---------------------------------------------------------------------------

export interface ServiceViolation {
  ruleKey: string
  title: string
  description: string
  severity: string
  serviceName: string
  /** For dependency violations: the service on the other end of the edge */
  relatedServiceName?: string
}

export interface ModuleViolation {
  ruleKey: string
  title: string
  description: string
  severity: string
  serviceName: string
  moduleName?: string
  methodName?: string
  filePath: string
  /** For dependency violations: the module on the other end of the edge */
  relatedModuleName?: string
}

// ---------------------------------------------------------------------------
// Service-level checks
// ---------------------------------------------------------------------------

const GOD_SERVICE_FILE_THRESHOLD = 120
const GOD_SERVICE_LAYER_THRESHOLD = 4

/**
 * Check deterministic service-level rules and return violations.
 */
export function checkServiceRules(
  services: ServiceInfo[],
  dependencies: ServiceDependencyInfo[],
  enabledRules: AnalysisRule[],
): ServiceViolation[] {
  const violations: ServiceViolation[] = []
  const ruleKeys = new Set(enabledRules.filter(r => r.type === 'deterministic' && r.enabled).map(r => r.key))

  // Circular service dependency — Tarjan's SCC detects all cycles including transitive
  if (ruleKeys.has('architecture/deterministic/circular-service-dependency')) {
    const adjacency = new Map<string, Set<string>>()
    for (const dep of dependencies) {
      if (!adjacency.has(dep.source)) adjacency.set(dep.source, new Set())
      adjacency.get(dep.source)!.add(dep.target)
    }

    const { cycles } = findCycles(adjacency)

    for (const cycle of cycles) {
      const severity = cycle.isTypeOnly ? 'info' : cycle.isDynamic ? 'low' : 'high'
      const chainDisplay = cycle.chain.join(' \u2192 ')
      const qualifier = cycle.isTypeOnly
        ? ' (type-only imports \u2014 no runtime impact)'
        : cycle.isDynamic
          ? ' (dynamic imports \u2014 lower risk)'
          : ''

      violations.push({
        ruleKey: 'architecture/deterministic/circular-service-dependency',
        title: `Circular dependency: ${chainDisplay}`,
        description: `Circular dependency chain: ${chainDisplay}${qualifier}. Consider extracting shared logic into a separate service or reversing one direction.`,
        severity,
        serviceName: cycle.chain[0],
        relatedServiceName: cycle.chain[1],
      })
    }
  }

  // God service
  if (ruleKeys.has('architecture/deterministic/god-service')) {
    for (const svc of services) {
      const layerCount = svc.layers?.length || 0
      if (svc.fileCount > GOD_SERVICE_FILE_THRESHOLD || layerCount >= GOD_SERVICE_LAYER_THRESHOLD) {
        const reasons: string[] = []
        if (svc.fileCount > GOD_SERVICE_FILE_THRESHOLD) {
          reasons.push(`${svc.fileCount} files (threshold: ${GOD_SERVICE_FILE_THRESHOLD})`)
        }
        if (layerCount >= GOD_SERVICE_LAYER_THRESHOLD) {
          reasons.push(`${layerCount} layers (threshold: ${GOD_SERVICE_LAYER_THRESHOLD})`)
        }
        violations.push({
          ruleKey: 'architecture/deterministic/god-service',
          title: `God service: ${svc.name}`,
          description: `${svc.name} has ${reasons.join(' and ')}, suggesting too many responsibilities. Consider splitting into smaller, focused services.`,
          severity: 'medium',
          serviceName: svc.name,
        })
      }
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// Module-level checks
// ---------------------------------------------------------------------------

/** Build a map of direct function calls and references per file (no member access like obj.method). */
function buildSameFileCalls(fileAnalyses?: FileAnalysis[]): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>()
  if (!fileAnalyses) return result
  for (const fa of fileAnalyses) {
    const callees = new Set<string>()
    for (const call of fa.calls) {
      if (!call.callee.includes('.')) {
        callees.add(call.callee)
      }
      // Also capture function names passed as arguments (e.g., retry=should_retry_request)
      if (call.arguments) {
        for (const arg of call.arguments) {
          // Simple identifier arguments (no dots, no quotes, no operators)
          if (/^[A-Za-z_]\w*$/.test(arg)) {
            callees.add(arg)
          }
          // Keyword arguments: extract value side (e.g., "retry=should_retry" → "should_retry")
          const kwMatch = arg.match(/^[A-Za-z_]\w*=([A-Za-z_]\w*)$/)
          if (kwMatch) {
            callees.add(kwMatch[1])
          }
        }
      }
    }
    if (callees.size > 0) result.set(fa.filePath, callees)
  }
  return result
}

const GOD_MODULE_THRESHOLD = 15

/**
 * Check deterministic module-level rules and return violations.
 */
export function checkModuleRules(
  modules: ModuleInfo[],
  methods: MethodInfo[],
  fileDependencies: ModuleDependency[],
  enabledRules: AnalysisRule[],
  moduleLevelDeps?: ModuleLevelDependency[],
  dbConnectedModuleKeys?: Set<string>,
  fileAnalyses?: FileAnalysis[],
  libraryServiceNames?: Set<string>,
  entryPointFiles?: Set<string>,
  methodLevelDeps?: MethodLevelDependency[],
): ModuleViolation[] {
  const violations: ModuleViolation[] = []
  const ruleKeys = new Set(enabledRules.filter(r => r.type === 'deterministic' && r.enabled).map(r => r.key))

  // Circular module dependency — Tarjan's SCC on module-level dependency graph
  if (ruleKeys.has('architecture/deterministic/circular-module-dependency') && moduleLevelDeps) {
    const modAdjacency = new Map<string, Set<string>>()
    const modEdgeMeta = new Map<string, EdgeMetadata>()

    // Build module-level adjacency from moduleLevelDeps
    for (const dep of moduleLevelDeps) {
      const srcKey = `${dep.sourceService}::${dep.sourceModule}`
      const tgtKey = `${dep.targetService}::${dep.targetModule}`
      if (srcKey === tgtKey) continue // skip self-imports

      if (!modAdjacency.has(srcKey)) modAdjacency.set(srcKey, new Set())
      modAdjacency.get(srcKey)!.add(tgtKey)
    }

    // Classify edges using file-level import data when available
    if (fileAnalyses) {
      // Build module → filePath lookup
      const modFileMap = new Map<string, string>()
      for (const mod of modules) {
        modFileMap.set(`${mod.serviceName}::${mod.name}`, mod.filePath)
      }

      // Build file → imports lookup
      const fileImports = new Map<string, FileAnalysis['imports']>()
      for (const fa of fileAnalyses) {
        fileImports.set(fa.filePath, fa.imports)
      }

      // Build file → dynamic import targets (from calls with callee === 'import')
      const fileDynamicTargets = new Set<string>()
      for (const fa of fileAnalyses) {
        if (fa.calls) {
          for (const call of fa.calls) {
            if (call.callee === 'import') {
              fileDynamicTargets.add(fa.filePath)
            }
          }
        }
      }

      for (const dep of moduleLevelDeps) {
        const srcKey = `${dep.sourceService}::${dep.sourceModule}`
        const tgtKey = `${dep.targetService}::${dep.targetModule}`
        if (srcKey === tgtKey) continue

        const edgeKey = `${srcKey}::${tgtKey}`
        const srcFile = modFileMap.get(srcKey)
        if (!srcFile) continue

        const imports = fileImports.get(srcFile)
        if (imports) {
          // Check if this particular dependency is type-only
          const relevantImport = imports.find(imp =>
            dep.importedNames.some(name => imp.specifiers.some(s => s.name === name))
          )
          const isTypeOnly = relevantImport?.isTypeOnly ?? false
          const isDynamic = fileDynamicTargets.has(srcFile) && !relevantImport

          modEdgeMeta.set(edgeKey, { isDynamic, isTypeOnly })
        }
      }
    }

    const { cycles } = findCycles(modAdjacency, modEdgeMeta.size > 0 ? modEdgeMeta : undefined)

    for (const cycle of cycles) {
      const severity = cycle.isTypeOnly ? 'info' : cycle.isDynamic ? 'low' : 'high'
      // Extract readable module names from "service::module" keys
      const readableChain = cycle.chain.map(key => {
        const parts = key.split('::')
        return parts.length > 1 ? parts[1] : key
      })
      const chainDisplay = readableChain.join(' \u2192 ')
      const qualifier = cycle.isTypeOnly
        ? ' (type-only imports \u2014 no runtime impact)'
        : cycle.isDynamic
          ? ' (dynamic imports \u2014 lower risk)'
          : ''

      // Get service name and file path from first node
      const firstKey = cycle.chain[0]
      const firstMod = modules.find(m => `${m.serviceName}::${m.name}` === firstKey)
      const secondKey = cycle.chain.length > 1 ? cycle.chain[1] : cycle.chain[0]
      const secondMod = modules.find(m => `${m.serviceName}::${m.name}` === secondKey)

      violations.push({
        ruleKey: 'architecture/deterministic/circular-module-dependency',
        title: `Circular module dependency: ${chainDisplay}`,
        description: `Circular import chain: ${chainDisplay}${qualifier}. Circular dependencies make refactoring difficult and indicate unclear module boundaries.`,
        severity,
        serviceName: firstMod?.serviceName || 'unknown',
        moduleName: firstMod?.name,
        filePath: firstMod?.filePath || '',
        relatedModuleName: secondMod?.name,
      })
    }
  }

  // God module
  if (ruleKeys.has('architecture/deterministic/god-module')) {
    for (const mod of modules) {
      if (mod.methodCount > GOD_MODULE_THRESHOLD) {
        violations.push({
          ruleKey: 'architecture/deterministic/god-module',
          title: `God module: ${mod.name}`,
          description: `${mod.name} has ${mod.methodCount} methods (threshold: ${GOD_MODULE_THRESHOLD}). Consider splitting into smaller, focused modules.`,
          severity: 'medium',
          serviceName: mod.serviceName,
          moduleName: mod.name,
          filePath: mod.filePath,
        })
      }
    }
  }

  const calledInOwnFile = buildSameFileCalls(fileAnalyses)

  // Build set of class names used as type annotations anywhere in the codebase.
  // Handles compound types: "X | Y", "Optional[X]", "list[X]", "Dict[str, X]", etc.
  const usedAsType = new Set<string>()
  function addType(typeStr: string | undefined) {
    if (!typeStr) return
    // Split union types (X | Y, Union[X, Y]) and extract identifiers from generics
    const parts = typeStr.split(/[|,\[\]()]+/).map((s) => s.trim()).filter(Boolean)
    for (const part of parts) {
      // Skip builtins and common type keywords
      if (/^(str|int|float|bool|None|Any|string|number|void|undefined|null|Optional|Union|List|Dict|Set|Tuple|list|dict|set|tuple|type)$/i.test(part)) continue
      usedAsType.add(part)
    }
  }
  if (fileAnalyses) {
    for (const fa of fileAnalyses) {
      for (const fn of fa.functions) {
        for (const p of fn.params) addType(p.type)
        addType(fn.returnType)
      }
      for (const cls of fa.classes) {
        if (cls.superClass) usedAsType.add(cls.superClass)
        for (const iface of cls.interfaces || []) usedAsType.add(iface)
        for (const m of cls.methods) {
          for (const p of m.params) addType(p.type)
          addType(m.returnType)
        }
        for (const prop of cls.properties) addType(prop.type)
      }
    }
  }

  // Unused export — skip framework entry files (Next.js pages, layouts, route handlers, etc.)
  // and framework convention export names (GET, POST, generateMetadata, etc.)
  if (ruleKeys.has('architecture/deterministic/unused-export')) {
    const importedTargets = new Set<string>()
    for (const dep of fileDependencies) {
      for (const name of dep.importedNames) {
        importedTargets.add(name)
      }
    }
    // Also consider targets reached via method-level dependencies (constructor calls, etc.)
    if (methodLevelDeps) {
      for (const dep of methodLevelDeps) {
        importedTargets.add(dep.calleeModule)
        importedTargets.add(dep.calleeMethod)
      }
    }

    // Build set of class module names — methods inside classes are accessed
    // through the class instance, not individually imported
    const classModuleNames = new Set(
      modules.filter((m) => m.kind === 'class').map((m) => m.name)
    )

    // Build set of route handler names — functions consumed by the framework
    // via decorators (@app.route, @router.get) or router bindings (router.get('/', handler))
    const routeHandlerNames = new Set<string>()
    // Build set of module basenames that are targets of dynamic import() calls
    const dynamicImportModuleBasenames = new Set<string>()
    if (fileAnalyses) {
      for (const fa of fileAnalyses) {
        if (fa.routeRegistrations) {
          for (const route of fa.routeRegistrations) {
            if (route.handlerName) routeHandlerNames.add(route.handlerName)
          }
        }
        // Collect dynamic import() targets from call expressions
        for (const call of fa.calls) {
          if (call.callee === 'import' && call.arguments) {
            for (const arg of call.arguments) {
              const match = arg.match(/['"].*?([^/'"]+?)(?:\.\w+)?['"]$/)
              if (match) dynamicImportModuleBasenames.add(match[1])
            }
          }
        }
      }
    }

    for (const method of methods) {
      if (method.isExported && !importedTargets.has(method.name)) {
        // Skip exports from entry point files — they're consumed by the framework/runtime
        if (entryPointFiles?.has(method.filePath)) continue

        // Skip exports from shadcn/ui component library directories — these export all variants for consumer use
        if (/\/components\/ui\//.test(method.filePath)) continue

        // Skip class methods — they're accessed via the class, not individually imported
        if (classModuleNames.has(method.moduleName)) continue

        // Skip route handler functions — consumed by framework via decorators/bindings
        if (routeHandlerNames.has(method.name)) continue

        // Skip functions called directly within their own file
        if (calledInOwnFile.get(method.filePath)?.has(method.name)) continue

        // Skip exports from modules that are targets of dynamic import() calls
        // (e.g., `import('./utils')` makes all exports of utils reachable at runtime)
        const fileBasename = method.filePath.split('/').pop()?.replace(/\.\w+$/, '')
        if (fileBasename && dynamicImportModuleBasenames.has(fileBasename)) continue

        violations.push({
          ruleKey: 'architecture/deterministic/unused-export',
          title: `Unused export: ${method.name}`,
          description: `${method.name} is exported from ${method.moduleName} but never imported elsewhere in the codebase.`,
          severity: 'low',
          serviceName: method.serviceName,
          moduleName: method.moduleName,
          methodName: method.name,
          filePath: method.filePath,
        })
      }
    }

    for (const mod of modules) {
      if (mod.kind === 'class' && mod.exportCount > 0 && !importedTargets.has(mod.name)) {
        if (entryPointFiles?.has(mod.filePath)) continue

        // Skip classes used as type annotations (params, return types, superclasses)
        if (usedAsType.has(mod.name)) continue

        violations.push({
          ruleKey: 'architecture/deterministic/unused-export',
          title: `Unused export: ${mod.name}`,
          description: `Class ${mod.name} appears exported but is never imported elsewhere in the codebase.`,
          severity: 'low',
          serviceName: mod.serviceName,
          moduleName: mod.name,
          filePath: mod.filePath,
        })
      }
    }
  }

  // Dead module — skip framework entry files (loaded by the framework, not via imports)
  if (ruleKeys.has('architecture/deterministic/dead-module') && moduleLevelDeps) {
    const connectedModules = new Set<string>()
    for (const dep of moduleLevelDeps) {
      connectedModules.add(`${dep.sourceService}::${dep.sourceModule}`)
      connectedModules.add(`${dep.targetService}::${dep.targetModule}`)
    }
    // Also consider modules connected via method-level dependencies
    // (catches same-file class usage, constructor calls, etc.)
    if (methodLevelDeps) {
      for (const dep of methodLevelDeps) {
        connectedModules.add(`${dep.callerService}::${dep.callerModule}`)
        connectedModules.add(`${dep.calleeService}::${dep.calleeModule}`)
      }
    }

    // Build module → method names lookup for same-file reference checks
    const moduleMethodNames = new Map<string, string[]>()
    for (const m of methods) {
      const mKey = `${m.serviceName}::${m.moduleName}`
      const arr = moduleMethodNames.get(mKey) || []
      arr.push(m.name)
      moduleMethodNames.set(mKey, arr)
    }

    for (const mod of modules) {
      const key = `${mod.serviceName}::${mod.name}`
      if (!connectedModules.has(key) && !dbConnectedModuleKeys?.has(key)) {
        if (entryPointFiles?.has(mod.filePath)) continue

        // Skip classes used as type annotations (params, return types, superclasses)
        if (usedAsType.has(mod.name)) continue

        // Skip modules whose methods or name are referenced in the same file
        // (catches function references passed as arguments, e.g., retry=should_retry)
        const sameFileRefs = calledInOwnFile.get(mod.filePath)
        if (sameFileRefs) {
          const modMethods = moduleMethodNames.get(key) || []
          if (sameFileRefs.has(mod.name) || modMethods.some((m) => sameFileRefs.has(m))) continue
        }

        violations.push({
          ruleKey: 'architecture/deterministic/dead-module',
          title: `Dead module: ${mod.name}`,
          description: `${mod.name} in ${mod.serviceName} has no incoming or outgoing dependencies — it may be unused.`,
          severity: 'low',
          serviceName: mod.serviceName,
          moduleName: mod.name,
          filePath: mod.filePath,
        })
      }
    }
  }

  // Orphan file — skip framework entry files (Next.js pages, layouts, route handlers, etc.)
  // and common non-importable files (tests, configs, migrations, scripts)
  if (ruleKeys.has('architecture/deterministic/orphan-file') && fileAnalyses) {
    // Test/config files that are never imported but shouldn't be flagged as orphans
    const TEST_CONFIG_PATTERN = /\.test\.[^/]+$|\.spec\.[^/]+$|(?:^|\/)__tests__\/|\.config\.[^/]+$|(?:^|\/)migrations\/|(?:^|\/)seeds\/|(?:^|\/)bin\/|(?:^|\/)scripts\//

    const importedFiles = new Set<string>()
    for (const dep of fileDependencies) {
      importedFiles.add(dep.target)
    }

    for (const fa of fileAnalyses) {
      if (importedFiles.has(fa.filePath)) continue
      if (TEST_CONFIG_PATTERN.test(fa.filePath)) continue
      if (entryPointFiles?.has(fa.filePath)) continue

      const matchingModule = modules.find((m) => m.filePath === fa.filePath)
      const serviceName = matchingModule?.serviceName || 'unknown'
      const fileName = fa.filePath.split('/').pop() || fa.filePath

      violations.push({
        ruleKey: 'architecture/deterministic/orphan-file',
        title: `Orphan file: ${fileName}`,
        description: `${fa.filePath} is never imported by any other file in the codebase. It may be an unused module or a missing entry point.`,
        severity: 'low',
        serviceName,
        filePath: fa.filePath,
      })
    }
  }

  // Layer violations
  if (moduleLevelDeps) {
    const layerViolationRules: [string, string, string][] = []
    if (ruleKeys.has('architecture/deterministic/data-layer-depends-on-api')) layerViolationRules.push(['architecture/deterministic/data-layer-depends-on-api', 'data', 'api'])
    if (ruleKeys.has('architecture/deterministic/data-layer-depends-on-external')) layerViolationRules.push(['architecture/deterministic/data-layer-depends-on-external', 'data', 'external'])
    if (ruleKeys.has('architecture/deterministic/external-layer-depends-on-api')) layerViolationRules.push(['architecture/deterministic/external-layer-depends-on-api', 'external', 'api'])

    const moduleByKey = new Map(modules.map(m => [`${m.serviceName}::${m.name}`, m]))

    if (layerViolationRules.length > 0) {
      for (const dep of moduleLevelDeps) {
        const srcMod = moduleByKey.get(`${dep.sourceService}::${dep.sourceModule}`)
        const tgtMod = moduleByKey.get(`${dep.targetService}::${dep.targetModule}`)
        if (!srcMod || !tgtMod) continue

        for (const [ruleKey, srcLayer, tgtLayer] of layerViolationRules) {
          if (srcMod.layerName === srcLayer && tgtMod.layerName === tgtLayer) {
            // Skip modules in workers/jobs directories — these are infrastructure, not a true layer violation
            if ((srcLayer === 'data' || srcLayer === 'external') && /\/(?:workers|jobs)\//.test(srcMod.filePath)) continue
            violations.push({
              ruleKey,
              title: `Layer violation: ${srcMod.name} → ${tgtMod.name}`,
              description: `${srcMod.name} (${srcLayer} layer) imports from ${tgtMod.name} (${tgtLayer} layer) in ${srcMod.serviceName}. ${srcLayer} layer should not depend on ${tgtLayer} layer.`,
              severity: ruleKey === 'architecture/deterministic/data-layer-depends-on-api' ? 'high' : 'medium',
              serviceName: srcMod.serviceName,
              moduleName: srcMod.name,
              filePath: srcMod.filePath,
              relatedModuleName: tgtMod.name,
            })
          }
        }
      }
    }

    // Cross-service internal import (skip library services — their internals are public)
    if (ruleKeys.has('architecture/deterministic/cross-service-internal-import')) {
      const internalLayers = new Set(['data', 'service', 'external'])

      // Build a lookup of file imports for path-alias detection
      const fileImportSources = new Map<string, Set<string>>()
      if (fileAnalyses) {
        for (const fa of fileAnalyses) {
          const sources = new Set<string>()
          for (const imp of fa.imports) {
            sources.add(imp.source)
          }
          fileImportSources.set(fa.filePath, sources)
        }
      }

      for (const dep of moduleLevelDeps) {
        if (dep.sourceService === dep.targetService) continue
        if (libraryServiceNames?.has(dep.targetService)) continue
        const srcMod = moduleByKey.get(`${dep.sourceService}::${dep.sourceModule}`)
        const tgtMod = moduleByKey.get(`${dep.targetService}::${dep.targetModule}`)
        if (!srcMod || !tgtMod) continue
        if (!internalLayers.has(tgtMod.layerName)) continue

        // Skip ALL imports that use @/ or ~/ path aliases — these ALWAYS resolve
        // locally within the app, so it's never a real cross-service import.
        if (dep.sourceFilePath) {
          const importSources = fileImportSources.get(dep.sourceFilePath)
          if (importSources) {
            const hasAnyLocalAlias = [...importSources].some((src) =>
              src.startsWith('@/') || src.startsWith('~/')
            )
            if (hasAnyLocalAlias) continue
          }
        }

        violations.push({
          ruleKey: 'architecture/deterministic/cross-service-internal-import',
          title: `Cross-service internal import: ${srcMod.name} → ${tgtMod.name}`,
          description: `${srcMod.name} in ${srcMod.serviceName} imports ${tgtMod.name} from ${tgtMod.serviceName}'s ${tgtMod.layerName} layer. Services should only depend on each other's API layer, not internal modules.`,
          severity: 'high',
          serviceName: srcMod.serviceName,
          moduleName: srcMod.name,
          filePath: srcMod.filePath,
          relatedModuleName: tgtMod.name,
        })
      }
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// Method-level checks
// ---------------------------------------------------------------------------

const LONG_METHOD_STATEMENTS = 30
const TOO_MANY_PARAMS = 5
const DEEP_NESTING_THRESHOLD = 4

/**
 * Check deterministic method-level rules and return violations.
 */
export function checkMethodRules(
  methods: MethodInfo[],
  enabledRules: AnalysisRule[],
  methodLevelDeps?: MethodLevelDependency[],
  entryPointFiles?: Set<string>,
  fileAnalyses?: FileAnalysis[],
): ModuleViolation[] {
  const violations: ModuleViolation[] = []
  const ruleKeys = new Set(enabledRules.filter(r => r.type === 'deterministic' && r.enabled).map(r => r.key))
  const calledInOwnFile = buildSameFileCalls(fileAnalyses)

  // Long method
  if (ruleKeys.has('architecture/deterministic/long-method')) {
    for (const method of methods) {
      if (method.statementCount != null && method.statementCount > LONG_METHOD_STATEMENTS) {
        violations.push({
          ruleKey: 'architecture/deterministic/long-method',
          title: `Long method: ${method.moduleName}.${method.name}`,
          description: `${method.name} has ${method.statementCount} statements (threshold: ${LONG_METHOD_STATEMENTS}). Extract sub-routines to improve readability.`,
          severity: 'low',
          serviceName: method.serviceName,
          moduleName: method.moduleName,
          methodName: method.name,
          filePath: method.filePath,
        })
      }
    }
  }

  // Too many parameters
  if (ruleKeys.has('architecture/deterministic/too-many-parameters')) {
    for (const method of methods) {
      const paramThreshold = getMaxParameters(method.filePath)
      if (method.paramCount > paramThreshold) {
        violations.push({
          ruleKey: 'architecture/deterministic/too-many-parameters',
          title: `Too many parameters: ${method.moduleName}.${method.name}`,
          description: `${method.name} has ${method.paramCount} parameters (threshold: ${paramThreshold}). Consider using an options object or splitting the function.`,
          severity: 'low',
          serviceName: method.serviceName,
          moduleName: method.moduleName,
          methodName: method.name,
          filePath: method.filePath,
        })
      }
    }
  }

  // Deeply nested logic
  if (ruleKeys.has('architecture/deterministic/deeply-nested-logic')) {
    for (const method of methods) {
      if (method.maxNestingDepth != null && method.maxNestingDepth > DEEP_NESTING_THRESHOLD) {
        violations.push({
          ruleKey: 'architecture/deterministic/deeply-nested-logic',
          title: `Deeply nested: ${method.moduleName}.${method.name}`,
          description: `${method.name} has nesting depth ${method.maxNestingDepth} (threshold: ${DEEP_NESTING_THRESHOLD}). Use early returns or extract helper functions to flatten the logic.`,
          severity: 'medium',
          serviceName: method.serviceName,
          moduleName: method.moduleName,
          methodName: method.name,
          filePath: method.filePath,
        })
      }
    }
  }

  // Dead method — skip methods in framework entry files (React components, route handlers, etc.)
  // These are either consumed by the framework router or are internal functions called from JSX.
  if (ruleKeys.has('architecture/deterministic/dead-method') && methodLevelDeps) {
    const connectedMethods = new Set<string>()
    for (const dep of methodLevelDeps) {
      connectedMethods.add(`${dep.callerService}::${dep.callerModule}::${dep.callerMethod}`)
      connectedMethods.add(`${dep.calleeService}::${dep.calleeModule}::${dep.calleeMethod}`)
    }

    // Build set of method names referenced as event handler arguments
    // (e.g., .on('event', this.methodName), .once('close', this.handleClose))
    const eventHandlerMethods = new Set<string>()
    // Build set of class names that have an `implements` clause
    const classesWithImplements = new Set<string>()
    // Build set of method names referenced via dynamic import() or this.methodName in any expression
    const dynamicImportTargets = new Set<string>()
    // Build set of module basenames that are dynamically imported — exports from these modules are live
    const dynamicImportModules = new Set<string>()
    const thisRefMethods = new Set<string>()
    if (fileAnalyses) {
      for (const fa of fileAnalyses) {
        for (const call of fa.calls) {
          if (call.callee.endsWith('.on') || call.callee.endsWith('.once') || call.callee.endsWith('.addEventListener')) {
            if (call.arguments) {
              for (const arg of call.arguments) {
                // Match this.methodName patterns
                const thisMatch = arg.match(/^this\.(\w+)$/)
                if (thisMatch) eventHandlerMethods.add(thisMatch[1])
              }
            }
          }
          // Track dynamic import() targets — both function names and module paths
          if (call.callee === 'import' && call.arguments) {
            for (const arg of call.arguments) {
              // Extract identifier from the import path (last segment without extension)
              const match = arg.match(/['"].*?([^/'"]+?)(?:\.\w+)?['"]$/)
              if (match) {
                dynamicImportTargets.add(match[1])
                dynamicImportModules.add(match[1])
              }
            }
          }
          // Track this.methodName references in call arguments
          if (call.arguments) {
            for (const arg of call.arguments) {
              const thisRefs = arg.match(/this\.(\w+)/g)
              if (thisRefs) {
                for (const ref of thisRefs) {
                  thisRefMethods.add(ref.slice(5)) // strip "this."
                }
              }
            }
          }
          // Track this.methodName references in the callee itself
          // (e.g., this.handleResponse(), this.service.method())
          const calleeThisMatch = call.callee.match(/^this\.(\w+)/)
          if (calleeThisMatch) thisRefMethods.add(calleeThisMatch[1])
        }
        for (const cls of fa.classes) {
          if (cls.interfaces && cls.interfaces.length > 0) {
            classesWithImplements.add(cls.name)
          }
        }
      }
    }

    // Build a lookup from method file path → file basename for dynamic import matching
    const moduleFileToBasename = new Map<string, string>()
    for (const m of methods) {
      if (!moduleFileToBasename.has(m.filePath)) {
        const basename = m.filePath.split('/').pop()?.replace(/\.\w+$/, '')
        if (basename) moduleFileToBasename.set(m.filePath, basename)
      }
    }

    for (const method of methods) {
      const key = `${method.serviceName}::${method.moduleName}::${method.name}`
      if (!connectedMethods.has(key)) {
        // Skip methods in framework entry files — they're invoked by the framework
        // or called from JSX which isn't tracked in method-level dependencies
        if (entryPointFiles?.has(method.filePath)) continue

        // Skip functions called directly within their own file
        if (calledInOwnFile.get(method.filePath)?.has(method.name)) continue

        // Skip methods called implicitly by the runtime (e.g., Python dunders, JS constructors)
        if (method.isImplicitCall) continue

        // Skip PascalCase exports — likely React components called via JSX
        // which the method-level dependency graph can't reliably track
        if (/^[A-Z][a-zA-Z0-9]*$/.test(method.name) && method.isExported) continue

        // Skip methods bound as event handlers (.on('event', this.method), .addEventListener, etc.)
        if (eventHandlerMethods.has(method.name)) continue

        // Skip methods in classes with `implements` clause — they fulfill an interface contract
        if (classesWithImplements.has(method.moduleName)) continue

        // Skip methods whose name appears as a dynamic import() target
        if (dynamicImportTargets.has(method.name)) continue

        // Skip exported methods from modules that are targets of dynamic import() calls
        // (e.g., `import('./utils')` makes all exports of utils.ts reachable)
        if (method.isExported) {
          const basename = moduleFileToBasename.get(method.filePath)
          if (basename && dynamicImportModules.has(basename)) continue
        }

        // Skip methods referenced as this.methodName in any expression
        if (thisRefMethods.has(method.name)) continue

        violations.push({
          ruleKey: 'architecture/deterministic/dead-method',
          title: `Dead method: ${method.moduleName}.${method.name}`,
          description: `${method.name} in ${method.moduleName} (${method.serviceName}) has no incoming or outgoing calls — it may be unused.`,
          severity: 'low',
          serviceName: method.serviceName,
          moduleName: method.moduleName,
          methodName: method.name,
          filePath: method.filePath,
        })
      }
    }
  }

  return violations
}
