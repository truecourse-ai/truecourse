import { resolve, dirname, join } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import type { FileAnalysis, ModuleDependency, SupportedLanguage } from '@truecourse/shared'
import { getLanguageConfig } from './language-config.js'
import { monorepoPatterns } from './patterns/service-patterns.js'

/**
 * Build a map of workspace package names to their root directories
 * by scanning monorepo pattern directories for package.json files
 */
function buildWorkspacePackageMap(rootPath: string): Map<string, string> {
  const packageMap = new Map<string, string>()

  for (const pattern of monorepoPatterns) {
    const dirPath = join(rootPath, pattern)
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) continue

    try {
      const entries = readdirSync(dirPath)
      for (const entry of entries) {
        const pkgDir = join(dirPath, entry)
        const pkgJsonPath = join(pkgDir, 'package.json')

        if (!existsSync(pkgJsonPath)) continue

        try {
          const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
          if (pkg.name) {
            packageMap.set(pkg.name, pkgDir)
          }
        } catch {
          // skip invalid package.json
        }
      }
    } catch {
      // skip unreadable directories
    }
  }

  return packageMap
}

/**
 * Resolve a workspace package import to an entry point file
 */
function resolveWorkspaceImport(
  importSource: string,
  workspacePackages: Map<string, string>,
  existingFiles: Set<string>,
  language: SupportedLanguage,
): string | null {
  // Check exact package name match
  const pkgDir = workspacePackages.get(importSource)
  if (!pkgDir) return null

  const config = getLanguageConfig(language)
  const { extensions, indexFiles } = config.moduleResolution

  // Try to resolve via package.json "main" field
  const pkgJsonPath = join(pkgDir, 'package.json')
  if (existsSync(pkgJsonPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'))
      const mainField = pkg.main || pkg.module
      if (mainField) {
        const mainPath = resolve(pkgDir, mainField)
        if (existingFiles.has(mainPath)) return mainPath

        // Try with extensions
        for (const ext of extensions) {
          const candidate = mainPath.endsWith(ext) ? mainPath : mainPath + ext
          if (existingFiles.has(candidate)) return candidate
        }
      }
    } catch {
      // skip
    }
  }

  // Fall back to src/index.* or index.*
  const srcDir = join(pkgDir, 'src')
  for (const indexFile of indexFiles) {
    const candidates = [
      join(srcDir, indexFile),
      join(pkgDir, indexFile),
    ]
    for (const candidate of candidates) {
      if (existingFiles.has(candidate)) return candidate
    }
  }

  return null
}

/**
 * Build module dependency graph from file analyses
 * Resolves relative import paths and workspace package imports to absolute file paths
 */
export function buildDependencyGraph(
  files: FileAnalysis[],
  rootPath?: string,
): ModuleDependency[] {
  const dependencies: ModuleDependency[] = []

  // Create a map of file paths for quick lookup
  const filePaths = new Set(files.map(f => f.filePath))

  // Build workspace package map if rootPath is provided
  const workspacePackages = rootPath
    ? buildWorkspacePackageMap(rootPath)
    : new Map<string, string>()

  for (const file of files) {
    for (const importStmt of file.imports) {
      const importSource = importStmt.source

      if (importSource.startsWith('.')) {
        // Resolve relative import
        const fileDir = dirname(file.filePath)
        const resolvedPath = resolveImportPath(fileDir, importSource, file.language, filePaths)

        if (resolvedPath) {
          dependencies.push({
            source: file.filePath,
            target: resolvedPath,
            importedNames: importStmt.specifiers.map((spec) => spec.name),
          })
        }
      } else if (workspacePackages.size > 0) {
        // Try to resolve as workspace package import
        const resolvedPath = resolveWorkspaceImport(
          importSource,
          workspacePackages,
          filePaths,
          file.language,
        )

        if (resolvedPath) {
          dependencies.push({
            source: file.filePath,
            target: resolvedPath,
            importedNames: importStmt.specifiers.map((spec) => spec.name),
          })
        }
      }
    }
  }

  return dependencies
}

/**
 * Resolve a relative import path to an absolute file path
 * Uses language-specific module resolution configuration
 */
function resolveImportPath(
  fromDir: string,
  importPath: string,
  language: SupportedLanguage,
  existingFiles: Set<string>
): string | null {
  const config = getLanguageConfig(language)
  const { extensions, indexFiles } = config.moduleResolution

  // Remove any extension that matches the language's extensions
  let cleanPath = importPath
  for (const ext of extensions) {
    if (cleanPath.endsWith(ext)) {
      cleanPath = cleanPath.slice(0, -ext.length)
      break
    }
  }

  // Try different extensions
  for (const ext of extensions) {
    const candidatePath = resolve(fromDir, cleanPath + ext)
    if (existingFiles.has(candidatePath)) {
      return candidatePath
    }
  }

  // Try as-is (might already have extension)
  const asIsPath = resolve(fromDir, importPath)
  if (existingFiles.has(asIsPath)) {
    return asIsPath
  }

  // Try index files for directory imports
  for (const indexFile of indexFiles) {
    const indexPath = resolve(fromDir, cleanPath, indexFile)
    if (existingFiles.has(indexPath)) {
      return indexPath
    }
  }

  // If we can't resolve it, return null (might be a package or missing file)
  return null
}

/**
 * Find entry points (files that are not imported by anyone)
 */
export function findEntryPoints(
  files: FileAnalysis[],
  dependencies: ModuleDependency[]
): string[] {
  // Build set of all imported file paths (targets)
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
