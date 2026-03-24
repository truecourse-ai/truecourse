import { resolve, dirname } from 'path'
import { realpathSync } from 'fs'
import type { FileAnalysis, ModuleDependency } from '@truecourse/shared'
import { buildScopedCompilerOptions, resolveModule, type ScopedCompilerOptions } from './ts-compiler.js'

// Common TS/JS extensions for fallback resolution (when no tsconfig exists)
const FALLBACK_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts']
const FALLBACK_INDEX_FILES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx']

/**
 * Fallback resolution for relative imports when no tsconfig is available.
 * Tries extension probing and index file resolution against analyzed files.
 */
function resolveRelativeFallback(
  importSource: string,
  containingFile: string,
  analyzedFiles: Set<string>,
): string | null {
  const fromDir = dirname(containingFile)
  const basePath = resolve(fromDir, importSource)

  // Try as-is
  if (analyzedFiles.has(basePath)) return basePath

  // Try with extensions
  for (const ext of FALLBACK_EXTENSIONS) {
    const candidate = basePath + ext
    if (analyzedFiles.has(candidate)) return candidate
    // Also try stripping existing extension first
    const stripped = basePath.replace(/\.[^.]+$/, '') + ext
    if (stripped !== candidate && analyzedFiles.has(stripped)) return stripped
  }

  // Try index files
  for (const indexFile of FALLBACK_INDEX_FILES) {
    const candidate = resolve(basePath, indexFile)
    if (analyzedFiles.has(candidate)) return candidate
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
      // Try TS compiler resolution first
      let resolved = resolveModule(dep.source, file.filePath, scoped)

      // TS compiler may resolve to a symlink path (e.g., node_modules/@pkg → packages/pkg).
      // Resolve to real path so it matches the analyzed file set.
      if (resolved && !analyzedFiles.has(resolved)) {
        try { resolved = realpathSync(resolved) } catch { /* keep as-is */ }
      }

      // Fallback for relative imports when TS compiler can't resolve
      // (no tsconfig, or files don't exist on disk like in tests)
      if (!resolved && dep.source.startsWith('.')) {
        resolved = resolveRelativeFallback(dep.source, file.filePath, analyzedFiles)
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
              resolved = resolveRelativeFallback(specifier, file.filePath, analyzedFiles)
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
