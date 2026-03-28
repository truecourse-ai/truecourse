import { resolve, dirname, join } from 'path'
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'fs'
import type { FileAnalysis, ModuleDependency } from '@truecourse/shared'
import { buildScopedCompilerOptions, resolveModule, type ScopedCompilerOptions } from './ts-compiler.js'
import { monorepoPatterns } from './patterns/service-patterns.js'
import { getImportResolver } from './resolvers/registry.js'
import { getLanguageConfig } from './language-config.js'

/**
 * Fallback resolution for relative imports when the language compiler can't resolve.
 * Tries extension probing and index file resolution against analyzed files,
 * using the language's configured extensions and index files.
 */
function resolveRelativeFallback(
  importSource: string,
  containingFile: string,
  analyzedFiles: Set<string>,
  extensions: string[],
  indexFiles: string[],
): string | null {
  const fromDir = dirname(containingFile)
  const basePath = resolve(fromDir, importSource)

  // Try as-is
  if (analyzedFiles.has(basePath)) return basePath

  // Try with extensions
  for (const ext of extensions) {
    const candidate = basePath + ext
    if (analyzedFiles.has(candidate)) return candidate
    const stripped = basePath.replace(/\.[^.]+$/, '') + ext
    if (stripped !== candidate && analyzedFiles.has(stripped)) return stripped
  }

  // Try index files
  for (const indexFile of indexFiles) {
    const candidate = resolve(basePath, indexFile)
    if (analyzedFiles.has(candidate)) return candidate
  }

  return null
}

/**
 * Build a map of workspace package names to their root directories.
 * Fallback for when the TS compiler can't resolve workspace imports
 * (e.g., projects without tsconfig.json).
 */
function buildWorkspacePackageMap(rootPath: string): Map<string, string> {
  const packageMap = new Map<string, string>()
  for (const pattern of monorepoPatterns) {
    const dirPath = join(rootPath, pattern)
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) continue
    try {
      for (const entry of readdirSync(dirPath)) {
        const pkgDir = join(dirPath, entry)
        const pkgJsonPath = join(pkgDir, 'package.json')
        if (!existsSync(pkgJsonPath)) continue
        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
          if (pkg.name) packageMap.set(pkg.name, pkgDir)
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return packageMap
}

/**
 * Resolve a workspace package import to a file path.
 * Handles both exact matches (@sample/shared-utils) and deep imports (@sample/shared-utils/foo).
 */
function resolveWorkspaceFallback(
  importSource: string,
  workspacePackages: Map<string, string>,
  analyzedFiles: Set<string>,
  extensions: string[],
  indexFiles: string[],
): string | null {
  let pkgDir = workspacePackages.get(importSource)
  let subPath: string | null = null

  if (!pkgDir) {
    for (const [pkgName, dir] of workspacePackages) {
      if (importSource.startsWith(pkgName + '/')) {
        pkgDir = dir
        subPath = importSource.slice(pkgName.length + 1)
        break
      }
    }
  }
  if (!pkgDir) return null

  if (subPath) {
    return resolveRelativeFallback('./' + subPath, join(pkgDir, 'dummy.ts'), analyzedFiles, extensions, indexFiles)
  }

  const pkgJsonPath = join(pkgDir, 'package.json')
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
      const mainField = pkg.main || pkg.module
      if (mainField) {
        const mainPath = resolve(pkgDir, mainField)
        if (analyzedFiles.has(mainPath)) return mainPath
        for (const ext of extensions) {
          const candidate = mainPath.endsWith(ext) ? mainPath : mainPath + ext
          if (analyzedFiles.has(candidate)) return candidate
        }
      }
    } catch { /* skip */ }
  }

  for (const indexFile of indexFiles) {
    for (const candidate of [join(pkgDir, 'src', indexFile), join(pkgDir, indexFile)]) {
      if (analyzedFiles.has(candidate)) return candidate
    }
  }

  return null
}


/**
 * Build module dependency graph from file analyses.
 * Uses the TypeScript Compiler API for module resolution — handles path aliases,
 * workspace packages, re-exports, extension probing, and all moduleResolution
 * strategies natively via ts.resolveModuleName.
 *
 * Falls back to basic relative resolution when no tsconfig is available
 * (e.g., in test fixtures or JS-only projects).
 */
export function buildDependencyGraph(
  files: FileAnalysis[],
  rootPath?: string,
): ModuleDependency[] {
  const dependencies: ModuleDependency[] = []

  // Build scoped compiler options from tsconfig.json files
  const scoped: ScopedCompilerOptions[] = rootPath
    ? buildScopedCompilerOptions(rootPath)
    : []

  // Workspace package map — fallback for non-relative imports without tsconfig
  const workspacePackages = rootPath
    ? buildWorkspacePackageMap(rootPath)
    : new Map<string, string>()

  // Set of analyzed file paths for filtering resolved targets
  const analyzedFiles = new Set(files.map((f) => f.filePath))

  for (const file of files) {
    // Collect import sources: both imports and re-exports (export { x } from './y')
    const depSources: { source: string; names: string[] }[] = []

    for (const importStmt of file.imports) {
      depSources.push({
        source: importStmt.source,
        names: importStmt.specifiers.map((spec) => spec.name),
      })
    }

    for (const exportStmt of file.exports) {
      if (exportStmt.source) {
        depSources.push({
          source: exportStmt.source,
          names: [exportStmt.name],
        })
      }
    }

    // Resolve each import/re-export to an absolute file path
    for (const dep of depSources) {
      let resolved: string | null = null

      const customResolver = getImportResolver(file.language)
      if (customResolver && rootPath) {
        resolved = customResolver(dep.source, file.filePath, rootPath, analyzedFiles)
      } else {
        // TS/JS: Try TS compiler resolution first
        resolved = resolveModule(dep.source, file.filePath, scoped)

        // TS compiler may resolve to a symlink path (e.g., node_modules/@pkg → packages/pkg).
        // Resolve to real path so it matches the analyzed file set.
        if (resolved && !analyzedFiles.has(resolved)) {
          try { resolved = realpathSync(resolved) } catch { /* keep as-is */ }
        }

        // Fallback for relative imports when compiler can't resolve
        if (!resolved && dep.source.startsWith('.')) {
          const config = getLanguageConfig(file.language)
          resolved = resolveRelativeFallback(dep.source, file.filePath, analyzedFiles, config.moduleResolution.extensions, config.moduleResolution.indexFiles)
        }

        // Fallback for workspace package imports (e.g., @sample/shared-utils)
        if (!resolved && !dep.source.startsWith('.') && workspacePackages.size > 0) {
          const config = getLanguageConfig(file.language)
          resolved = resolveWorkspaceFallback(dep.source, workspacePackages, analyzedFiles, config.moduleResolution.extensions, config.moduleResolution.indexFiles)
        }
      }

      if (resolved && analyzedFiles.has(resolved)) {
        dependencies.push({
          source: file.filePath,
          target: resolved,
          importedNames: dep.names,
        })
      }
    }

    // Also resolve dynamic imports: import('...') calls
    if (file.calls) {
      for (const call of file.calls) {
        if (call.callee === 'import' && call.arguments?.length === 1) {
          const specifier = call.arguments[0].replace(/^['"]|['"]$/g, '')
          if (specifier) {
            let resolved = resolveModule(specifier, file.filePath, scoped)
            if (resolved && !analyzedFiles.has(resolved)) {
              try { resolved = realpathSync(resolved) } catch { /* keep as-is */ }
            }
            if (!resolved && specifier.startsWith('.')) {
              const config = getLanguageConfig(file.language)
              resolved = resolveRelativeFallback(specifier, file.filePath, analyzedFiles, config.moduleResolution.extensions, config.moduleResolution.indexFiles)
            }
            if (!resolved && !specifier.startsWith('.') && workspacePackages.size > 0) {
              const config = getLanguageConfig(file.language)
              resolved = resolveWorkspaceFallback(specifier, workspacePackages, analyzedFiles, config.moduleResolution.extensions, config.moduleResolution.indexFiles)
            }
            if (resolved && analyzedFiles.has(resolved)) {
              dependencies.push({
                source: file.filePath,
                target: resolved,
                importedNames: [],
              })
            }
          }
        }
      }
    }
  }

  return dependencies
}

/**
 * Find entry points — files that are not imported by anyone.
 * These are structural entry points: framework-routed files (page.tsx, layout.tsx),
 * scripts, CLI entry points, etc. Used by deterministic rules to avoid flagging
 * framework entry files as dead/unused.
 */
export function findEntryPoints(
  files: FileAnalysis[],
  dependencies: ModuleDependency[],
): string[] {
  const importedFiles = new Set<string>()
  for (const dep of dependencies) {
    importedFiles.add(dep.target)
  }

  const entryPoints: string[] = []
  for (const file of files) {
    if (!importedFiles.has(file.filePath)) {
      entryPoints.push(file.filePath)
    }
  }

  return entryPoints
}
