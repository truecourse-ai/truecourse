import path from 'path'
import type {
  FileAnalysis,
  ModuleDependency,
  LayerDetail,
  ModuleInfo,
  MethodInfo,
  ModuleLevelDependency,
  MethodLevelDependency,
  FunctionDefinition,
} from '@truecourse/shared'

export interface ModuleExtractionResult {
  modules: ModuleInfo[]
  methods: MethodInfo[]
  moduleDependencies: ModuleLevelDependency[]
  methodDependencies: MethodLevelDependency[]
}

/**
 * Extract modules and methods from analyzed files, grouped by service and layer.
 */
export function extractModulesAndMethods(
  analyses: FileAnalysis[],
  layerDetails: LayerDetail[],
  fileDependencies: ModuleDependency[],
): ModuleExtractionResult {
  const modules: ModuleInfo[] = []
  const methods: MethodInfo[] = []

  // Build file → (serviceName, layerName) lookup
  const fileLookup = new Map<string, { serviceName: string; layerName: string }>()
  for (const detail of layerDetails) {
    for (const fp of detail.filePaths) {
      if (!fileLookup.has(fp)) {
        fileLookup.set(fp, { serviceName: detail.serviceName, layerName: detail.layer })
      }
    }
  }

  // Build file → module name lookup (for dependency mapping)
  const fileToModules = new Map<string, string[]>()

  for (const analysis of analyses) {
    const info = fileLookup.get(analysis.filePath)
    if (!info) continue

    const { serviceName, layerName } = info

    // Extract class-based modules
    for (const cls of analysis.classes) {
      const modName = cls.name
      const namedMethods = cls.methods.filter((m) => m.name !== 'anonymous')

      modules.push({
        name: modName,
        filePath: analysis.filePath,
        kind: cls.interfaces && cls.methods.length === 0 && cls.properties.length === 0
          ? 'interface'
          : 'class',
        serviceName,
        layerName,
        methodCount: namedMethods.length,
        propertyCount: cls.properties.length,
        importCount: analysis.imports.length,
        exportCount: analysis.exports.length,
        superClass: cls.superClass,
        lineCount: cls.location.endLine - cls.location.startLine + 1,
      })

      // Extract methods from class
      for (const method of namedMethods) {
        methods.push(toMethodInfo(method, modName, serviceName, analysis.filePath))
      }

      addToFileModules(fileToModules, analysis.filePath, modName)
    }

    // If file has no classes but has functions or exports → standalone module
    if (analysis.classes.length === 0 && (analysis.functions.length > 0 || analysis.exports.length > 0)) {
      const modName = deriveModuleName(analysis)
      const namedFunctions = analysis.functions.filter((f) => f.name !== 'anonymous')

      modules.push({
        name: modName,
        filePath: analysis.filePath,
        kind: 'standalone',
        serviceName,
        layerName,
        methodCount: namedFunctions.length,
        propertyCount: 0,
        importCount: analysis.imports.length,
        exportCount: analysis.exports.length,
        lineCount: totalFileLines(analysis),
      })

      for (const fn of namedFunctions) {
        methods.push(toMethodInfo(fn, modName, serviceName, analysis.filePath))
      }

      addToFileModules(fileToModules, analysis.filePath, modName)
    }
  }

  // Build module-level dependencies from file-level dependencies
  const moduleDependencies = buildModuleDependencies(fileDependencies, fileToModules, fileLookup)

  // Build method-level dependencies from call expressions
  const methodDependencies = buildMethodDependencies(analyses, modules, methods, fileLookup)

  return { modules, methods, moduleDependencies, methodDependencies }
}

function toMethodInfo(
  fn: FunctionDefinition,
  moduleName: string,
  serviceName: string,
  filePath: string,
): MethodInfo {
  const params = fn.params.map(p => p.type ? `${p.name}: ${p.type}` : p.name).join(', ')
  const ret = fn.returnType ? `: ${fn.returnType}` : ''
  const signature = `${fn.name}(${params})${ret}`

  return {
    name: fn.name,
    moduleName,
    serviceName,
    filePath,
    signature,
    paramCount: fn.params.length,
    returnType: fn.returnType,
    isAsync: fn.isAsync,
    isExported: fn.isExported,
    lineCount: fn.lineCount,
    statementCount: fn.statementCount,
    maxNestingDepth: fn.maxNestingDepth,
  }
}

/**
 * Derive a module name from the file's primary export or main function.
 *
 * Strategy:
 * - Next.js route/page files → derive from directory path (e.g. "api/dealers/[id]")
 * - Default export → use its name (e.g. `export default router`)
 * - Single non-reexport named export with no functions → use export name
 *   (e.g. `export const userRoutes = Router()` → "userRoutes")
 * - Multiple exported functions → use file name (e.g. helpers.ts → "helpers")
 * - Single function → use function name
 * - Fallback to file name
 */
function deriveModuleName(analysis: FileAnalysis): string {
  // Next.js convention: route.ts/page.tsx files export HTTP methods (GET, POST, etc.)
  // or page components. Derive a unique name from the directory path to avoid collisions.
  const nextjsName = deriveNextjsRouteName(analysis.filePath)
  if (nextjsName) {
    return nextjsName
  }

  // Prefer the default export name
  const defaultExport = analysis.exports.find((e) => e.isDefault && !e.source)
  if (defaultExport && defaultExport.name !== 'default') {
    return defaultExport.name
  }

  // If no functions but has exports (const exports like Router(), config objects)
  // use the primary export name
  const localExports = analysis.exports.filter((e) => !e.isDefault && !e.source)
  if (analysis.functions.length === 0 && localExports.length > 0) {
    return localExports[0].name
  }

  // Single exported function → use its name
  const exportedFns = analysis.functions.filter((f) => f.isExported)
  if (exportedFns.length === 1) {
    return exportedFns[0].name
  }

  // For index files, prefer first local export or first function name before directory fallback
  const baseName = fileBaseName(analysis.filePath)
  if (baseName === 'index' || GENERIC_DIR_NAMES.has(baseName)) {
    if (localExports.length > 0) return localExports[0].name
    if (analysis.functions.length > 0) return analysis.functions[0].name
  }

  // Fallback to file name (multiple functions, or no exports)
  return baseName
}

/**
 * For Next.js route.ts and page.tsx files, derive a unique module name from
 * the directory path relative to the app directory.
 *
 * Examples:
 *   app/api/dealers/[id]/route.ts       → "api/dealers/[id]"
 *   app/api/health/route.ts             → "api/health"
 *   app/(dashboard)/(pages)/dealers/page.tsx → "dealers"
 *   app/api/dealers/[id]/leases/route.ts → "api/dealers/[id]/leases"
 *
 * Returns null if the file doesn't match the Next.js route/page pattern.
 */
function deriveNextjsRouteName(filePath: string): string | null {
  const base = path.basename(filePath).replace(/\.(ts|tsx|js|jsx)$/, '')
  if (base !== 'route' && base !== 'page') return null

  // Find the "app" directory in the path to get the relative segment
  const parts = filePath.split(path.sep)
  const appIdx = parts.lastIndexOf('app')
  if (appIdx === -1) return null

  // Get path segments between "app" and the file name
  const segments = parts.slice(appIdx + 1, -1)

  // Filter out Next.js route group markers like (dashboard), (pages)
  const filtered = segments.filter((s) => !s.startsWith('('))

  if (filtered.length === 0) return base // root page/route

  return filtered.join('/')
}

const GENERIC_DIR_NAMES = new Set(['src', 'lib', 'dist', 'build', 'app', 'root'])

function fileBaseName(filePath: string): string {
  const base = path.basename(filePath)
  const name = base.replace(/\.(ts|tsx|js|jsx)$/, '')
  // For index files, use the parent directory name instead
  if (name === 'index') {
    return path.basename(path.dirname(filePath))
  }
  return name
}

function totalFileLines(analysis: FileAnalysis): number | undefined {
  let max = 0
  for (const fn of analysis.functions) {
    if (fn.location.endLine > max) max = fn.location.endLine
  }
  return max > 0 ? max : undefined
}

function addToFileModules(
  map: Map<string, string[]>,
  filePath: string,
  moduleName: string,
) {
  const existing = map.get(filePath)
  if (existing) {
    existing.push(moduleName)
  } else {
    map.set(filePath, [moduleName])
  }
}

function buildModuleDependencies(
  fileDeps: ModuleDependency[],
  fileToModules: Map<string, string[]>,
  fileLookup: Map<string, { serviceName: string; layerName: string }>,
): ModuleLevelDependency[] {
  const deps: ModuleLevelDependency[] = []
  const seen = new Set<string>()

  for (const dep of fileDeps) {
    const sourceModules = fileToModules.get(dep.source)
    const targetModules = fileToModules.get(dep.target)
    if (!sourceModules?.length || !targetModules?.length) continue

    const sourceInfo = fileLookup.get(dep.source)
    const targetInfo = fileLookup.get(dep.target)
    if (!sourceInfo || !targetInfo) continue

    // Map each source module to each target module
    for (const srcMod of sourceModules) {
      for (const tgtMod of targetModules) {
        if (srcMod === tgtMod && dep.source === dep.target) continue
        const key = `${sourceInfo.serviceName}::${srcMod}::${dep.source}::${targetInfo.serviceName}::${tgtMod}::${dep.target}`
        if (seen.has(key)) continue
        seen.add(key)

        deps.push({
          sourceModule: srcMod,
          sourceService: sourceInfo.serviceName,
          sourceFilePath: dep.source,
          targetModule: tgtMod,
          targetService: targetInfo.serviceName,
          targetFilePath: dep.target,
          importedNames: dep.importedNames,
        })
      }
    }
  }

  return deps
}

/**
 * Build method-level dependencies by matching call expressions to known methods.
 *
 * For each file's call expressions, we resolve:
 * - callerFunction (e.g. "UserController.getAll") → source method in source module
 * - callee (e.g. "this.userService.findAll" or "findAll") → target method in target module
 *
 * We match callees to methods within imported modules (from the file's import statements).
 */
function buildMethodDependencies(
  analyses: FileAnalysis[],
  allModules: ModuleInfo[],
  allMethods: MethodInfo[],
  fileLookup: Map<string, { serviceName: string; layerName: string }>,
): MethodLevelDependency[] {
  // Build method lookup: "serviceName::moduleName::methodName" → MethodInfo
  const methodLookup = new Map<string, MethodInfo>()
  for (const m of allMethods) {
    methodLookup.set(`${m.serviceName}::${m.moduleName}::${m.name}`, m)
  }

  // Build module lookup: "serviceName::moduleName" → ModuleInfo
  const moduleLookup = new Map<string, ModuleInfo>()
  for (const mod of allModules) {
    moduleLookup.set(`${mod.serviceName}::${mod.name}`, mod)
  }

  // Build file → modules in that file
  const fileModules = new Map<string, ModuleInfo[]>()
  for (const mod of allModules) {
    const arr = fileModules.get(mod.filePath) || []
    arr.push(mod)
    fileModules.set(mod.filePath, arr)
  }

  // Build module name → methods
  const methodsByModuleKey = new Map<string, MethodInfo[]>()
  for (const m of allMethods) {
    const key = `${m.serviceName}::${m.moduleName}`
    const arr = methodsByModuleKey.get(key) || []
    arr.push(m)
    methodsByModuleKey.set(key, arr)
  }

  const deps: MethodLevelDependency[] = []
  const seen = new Set<string>()
  const counts = new Map<string, number>()

  for (const analysis of analyses) {
    const info = fileLookup.get(analysis.filePath)
    if (!info) continue
    const { serviceName } = info

    const modsInFile = fileModules.get(analysis.filePath) || []
    if (modsInFile.length === 0) continue

    // Build set of imported module names from this file's imports
    // Map imported name → possible target modules
    const importedNames = new Set<string>()
    for (const imp of analysis.imports) {
      for (const spec of imp.specifiers) {
        importedNames.add(spec.alias || spec.name)
      }
    }

    for (const call of analysis.calls) {
      if (!call.callerFunction) continue

      // Resolve caller to a method in this file
      // callerFunction is like "ClassName.methodName" or just "functionName"
      const callerParts = call.callerFunction.split('.')
      let callerMethod: MethodInfo | undefined

      for (const mod of modsInFile) {
        const methodName = callerParts.length > 1 ? callerParts[callerParts.length - 1] : callerParts[0]
        callerMethod = methodLookup.get(`${serviceName}::${mod.name}::${methodName}`)
        if (callerMethod) break
      }
      if (!callerMethod) continue

      // Resolve callee to a target method
      // callee is like "this.service.method", "ClassName.method", "functionName", etc.
      // Strip leading "this."/"super."/"self." — these refer to instance properties, not builtins
      let normalizedCallee = call.callee
      for (const prefix of ['this.', 'super.', 'self.']) {
        if (normalizedCallee.startsWith(prefix)) {
          normalizedCallee = normalizedCallee.slice(prefix.length)
          break
        }
      }

      const calleeParts = normalizedCallee.split('.')
      const calleeMethodName = calleeParts[calleeParts.length - 1]

      // Skip common non-method calls
      if (isBuiltinCall(calleeMethodName, normalizedCallee)) continue

      let targetMethod: MethodInfo | undefined

      // Strategy 1: Check if callee receiver matches an imported class/module name
      if (calleeParts.length >= 2) {
        const receiverName = calleeParts[calleeParts.length - 2]

        // Look for a module with that name across all services
        for (const mod of allModules) {
          if (mod.name === receiverName || matchesLowerCase(mod.name, receiverName)) {
            targetMethod = methodLookup.get(`${mod.serviceName}::${mod.name}::${calleeMethodName}`)
            if (targetMethod) break
          }
        }
      }

      // Strategy 2: Receiver didn't match a module name directly (e.g. `repo.create()` where
      // `const repo = new UserRepository()`). Check imported modules for a matching method.
      if (!targetMethod && calleeParts.length >= 2) {
        for (const importedName of importedNames) {
          const candidate = methodLookup.get(`${serviceName}::${importedName}::${calleeMethodName}`)
          if (candidate) {
            targetMethod = candidate
            break
          }
          // Also check across all services
          for (const mod of allModules) {
            if (mod.name === importedName) {
              const c = methodLookup.get(`${mod.serviceName}::${mod.name}::${calleeMethodName}`)
              if (c) { targetMethod = c; break }
            }
          }
          if (targetMethod) break
        }
      }

      // Strategy 3: Simple function call matching an imported name (e.g. `findAll()`)
      if (!targetMethod && calleeParts.length === 1 && importedNames.has(calleeMethodName)) {
        for (const mod of allModules) {
          const candidate = methodLookup.get(`${mod.serviceName}::${mod.name}::${calleeMethodName}`)
          if (candidate && candidate.isExported) {
            targetMethod = candidate
            break
          }
        }
      }

      if (!targetMethod) continue
      // Skip self-calls within the same method
      if (targetMethod.moduleName === callerMethod.moduleName
        && targetMethod.name === callerMethod.name
        && targetMethod.serviceName === callerMethod.serviceName
        && targetMethod.filePath === callerMethod.filePath) continue

      const key = `${callerMethod.serviceName}::${callerMethod.moduleName}::${callerMethod.name}::${callerMethod.filePath}::${targetMethod.serviceName}::${targetMethod.moduleName}::${targetMethod.name}::${targetMethod.filePath}`
      counts.set(key, (counts.get(key) || 0) + 1)

      if (seen.has(key)) continue
      seen.add(key)
    }
  }

  // Convert to MethodLevelDependency with counts
  for (const [key, count] of counts) {
    const parts = key.split('::')
    deps.push({
      callerMethod: parts[2],
      callerModule: parts[1],
      callerService: parts[0],
      callerFilePath: parts[3],
      calleeMethod: parts[6],
      calleeModule: parts[5],
      calleeService: parts[4],
      calleeFilePath: parts[7],
      callCount: count,
    })
  }

  return deps
}

function matchesLowerCase(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

function isBuiltinCall(methodName: string, fullCallee: string): boolean {
  const builtins = new Set([
    'log', 'error', 'warn', 'info', 'debug', 'trace',
    'push', 'pop', 'shift', 'unshift', 'map', 'filter', 'reduce', 'forEach', 'some', 'every',
    'slice', 'splice', 'concat', 'join', 'split', 'trim', 'replace', 'match', 'test',
    'keys', 'values', 'entries', 'assign', 'freeze',
    'parse', 'stringify',
    'resolve', 'reject', 'then', 'catch', 'finally',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'require', 'import',
    'addEventListener', 'removeEventListener',
    'preventDefault', 'stopPropagation',
    'toString', 'valueOf',
    'hasOwnProperty',
    'next', 'return', 'throw',
    'emit', 'on', 'off', 'once',
  ])
  if (builtins.has(methodName)) return true
  // Skip console.*, Math.*, JSON.*, Object.*, Array.*, Promise.*, etc.
  const builtinReceivers = new Set([
    'console', 'Math', 'JSON', 'Object', 'Array', 'Promise',
    'Date', 'String', 'Number', 'Boolean', 'RegExp', 'Error',
    'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol',
    'process', 'Buffer', 'global', 'window', 'document',
    'res', 'req', 'response', 'request', 'ctx', 'context',
    'app', 'router', 'express',
    'db', 'connection', 'pool', 'client', 'query',
  ])
  const parts = fullCallee.split('.')
  if (parts.length >= 2 && builtinReceivers.has(parts[0])) return true
  return false
}
