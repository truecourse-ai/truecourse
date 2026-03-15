import path from 'path'
import type {
  FileAnalysis,
  ModuleDependency,
  LayerDetail,
  ModuleInfo,
  MethodInfo,
  ModuleLevelDependency,
  FunctionDefinition,
} from '@truecourse/shared'

export interface ModuleExtractionResult {
  modules: ModuleInfo[]
  methods: MethodInfo[]
  moduleDependencies: ModuleLevelDependency[]
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

      modules.push({
        name: modName,
        filePath: analysis.filePath,
        kind: cls.interfaces && cls.methods.length === 0 && cls.properties.length === 0
          ? 'interface'
          : 'class',
        serviceName,
        layerName,
        methodCount: cls.methods.length,
        propertyCount: cls.properties.length,
        importCount: analysis.imports.length,
        exportCount: analysis.exports.length,
        superClass: cls.superClass,
        lineCount: cls.location.endLine - cls.location.startLine + 1,
      })

      // Extract methods from class
      for (const method of cls.methods) {
        methods.push(toMethodInfo(method, modName, serviceName, analysis.filePath))
      }

      addToFileModules(fileToModules, analysis.filePath, modName)
    }

    // If file has no classes but has functions or exports → standalone module
    if (analysis.classes.length === 0 && (analysis.functions.length > 0 || analysis.exports.length > 0)) {
      const modName = deriveModuleName(analysis)

      modules.push({
        name: modName,
        filePath: analysis.filePath,
        kind: 'standalone',
        serviceName,
        layerName,
        methodCount: analysis.functions.length,
        propertyCount: 0,
        importCount: analysis.imports.length,
        exportCount: analysis.exports.length,
        lineCount: totalFileLines(analysis),
      })

      for (const fn of analysis.functions) {
        methods.push(toMethodInfo(fn, modName, serviceName, analysis.filePath))
      }

      addToFileModules(fileToModules, analysis.filePath, modName)
    }
  }

  // Build module-level dependencies from file-level dependencies
  const moduleDependencies = buildModuleDependencies(fileDependencies, fileToModules, fileLookup)

  return { modules, methods, moduleDependencies }
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
 * - Default export → use its name (e.g. `export default router`)
 * - Single non-reexport named export with no functions → use export name
 *   (e.g. `export const userRoutes = Router()` → "userRoutes")
 * - Multiple exported functions → use file name (e.g. helpers.ts → "helpers")
 * - Single function → use function name
 * - Fallback to file name
 */
function deriveModuleName(analysis: FileAnalysis): string {
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
        const key = `${sourceInfo.serviceName}::${srcMod}::${targetInfo.serviceName}::${tgtMod}`
        if (seen.has(key)) continue
        seen.add(key)

        deps.push({
          sourceModule: srcMod,
          sourceService: sourceInfo.serviceName,
          targetModule: tgtMod,
          targetService: targetInfo.serviceName,
          importedNames: dep.importedNames,
        })
      }
    }
  }

  return deps
}
