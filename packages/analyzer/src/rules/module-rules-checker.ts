import type { ModuleInfo, MethodInfo, ModuleDependency, ModuleLevelDependency, MethodLevelDependency, AnalysisRule, FileAnalysis } from '@truecourse/shared'
import { getMaxParameters } from '../language-config.js'

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

  // God module
  if (ruleKeys.has('arch/god-module')) {
    for (const mod of modules) {
      if (mod.methodCount > GOD_MODULE_THRESHOLD) {
        violations.push({
          ruleKey: 'arch/god-module',
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
  if (ruleKeys.has('arch/unused-export')) {
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
    if (fileAnalyses) {
      for (const fa of fileAnalyses) {
        if (fa.routeRegistrations) {
          for (const route of fa.routeRegistrations) {
            if (route.handlerName) routeHandlerNames.add(route.handlerName)
          }
        }
      }
    }

    for (const method of methods) {
      if (method.isExported && !importedTargets.has(method.name)) {
        // Skip exports from entry point files — they're consumed by the framework/runtime
        if (entryPointFiles?.has(method.filePath)) continue

        // Skip class methods — they're accessed via the class, not individually imported
        if (classModuleNames.has(method.moduleName)) continue

        // Skip route handler functions — consumed by framework via decorators/bindings
        if (routeHandlerNames.has(method.name)) continue

        // Skip functions called directly within their own file
        if (calledInOwnFile.get(method.filePath)?.has(method.name)) continue

        violations.push({
          ruleKey: 'arch/unused-export',
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
          ruleKey: 'arch/unused-export',
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
  if (ruleKeys.has('arch/dead-module') && moduleLevelDeps) {
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
          ruleKey: 'arch/dead-module',
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
  if (ruleKeys.has('arch/orphan-file') && fileAnalyses) {
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
        ruleKey: 'arch/orphan-file',
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
    if (ruleKeys.has('arch/module-layer-data-api')) layerViolationRules.push(['arch/module-layer-data-api', 'data', 'api'])
    if (ruleKeys.has('arch/module-layer-data-external')) layerViolationRules.push(['arch/module-layer-data-external', 'data', 'external'])
    if (ruleKeys.has('arch/module-layer-external-api')) layerViolationRules.push(['arch/module-layer-external-api', 'external', 'api'])

    const moduleByKey = new Map(modules.map(m => [`${m.serviceName}::${m.name}`, m]))

    if (layerViolationRules.length > 0) {
      for (const dep of moduleLevelDeps) {
        const srcMod = moduleByKey.get(`${dep.sourceService}::${dep.sourceModule}`)
        const tgtMod = moduleByKey.get(`${dep.targetService}::${dep.targetModule}`)
        if (!srcMod || !tgtMod) continue

        for (const [ruleKey, srcLayer, tgtLayer] of layerViolationRules) {
          if (srcMod.layerName === srcLayer && tgtMod.layerName === tgtLayer) {
            violations.push({
              ruleKey,
              title: `Layer violation: ${srcMod.name} → ${tgtMod.name}`,
              description: `${srcMod.name} (${srcLayer} layer) imports from ${tgtMod.name} (${tgtLayer} layer) in ${srcMod.serviceName}. ${srcLayer} layer should not depend on ${tgtLayer} layer.`,
              severity: ruleKey === 'arch/module-layer-data-api' ? 'high' : 'medium',
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
    if (ruleKeys.has('arch/cross-service-internal-import')) {
      const internalLayers = new Set(['data', 'service', 'external'])

      for (const dep of moduleLevelDeps) {
        if (dep.sourceService === dep.targetService) continue
        if (libraryServiceNames?.has(dep.targetService)) continue
        const srcMod = moduleByKey.get(`${dep.sourceService}::${dep.sourceModule}`)
        const tgtMod = moduleByKey.get(`${dep.targetService}::${dep.targetModule}`)
        if (!srcMod || !tgtMod) continue
        if (!internalLayers.has(tgtMod.layerName)) continue

        violations.push({
          ruleKey: 'arch/cross-service-internal-import',
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
  if (ruleKeys.has('arch/long-method')) {
    for (const method of methods) {
      if (method.statementCount != null && method.statementCount > LONG_METHOD_STATEMENTS) {
        violations.push({
          ruleKey: 'arch/long-method',
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
  if (ruleKeys.has('arch/too-many-parameters')) {
    for (const method of methods) {
      const paramThreshold = getMaxParameters(method.filePath)
      if (method.paramCount >= paramThreshold) {
        violations.push({
          ruleKey: 'arch/too-many-parameters',
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
  if (ruleKeys.has('arch/deeply-nested-logic')) {
    for (const method of methods) {
      if (method.maxNestingDepth != null && method.maxNestingDepth > DEEP_NESTING_THRESHOLD) {
        violations.push({
          ruleKey: 'arch/deeply-nested-logic',
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
  if (ruleKeys.has('arch/dead-method') && methodLevelDeps) {
    const connectedMethods = new Set<string>()
    for (const dep of methodLevelDeps) {
      connectedMethods.add(`${dep.callerService}::${dep.callerModule}::${dep.callerMethod}`)
      connectedMethods.add(`${dep.calleeService}::${dep.calleeModule}::${dep.calleeMethod}`)
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

        violations.push({
          ruleKey: 'arch/dead-method',
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
