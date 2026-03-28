import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import ignore from 'ignore'
import { detectLanguage, getAllIgnorePatterns, getAllTestPatterns } from './language-config.js'

/**
 * Find all .gitignore files from startDir up to root
 * Returns array of {path, dir} objects, ordered from root to startDir
 */
function findAllGitignores(startDir: string): Array<{ path: string; dir: string }> {
  const gitignores: Array<{ path: string; dir: string }> = []
  let currentDir = resolve(startDir)

  while (true) {
    const gitignorePath = join(currentDir, '.gitignore')
    if (existsSync(gitignorePath)) {
      gitignores.unshift({ path: gitignorePath, dir: currentDir })
    }

    const parentDir = resolve(currentDir, '..')
    // Reached root directory (on both Unix and Windows)
    if (parentDir === currentDir) {
      break
    }
    currentDir = parentDir
  }

  return gitignores
}

/**
 * Load ignore patterns from .gitignore and .truecourseignore files
 * Returns ignore instance and the root directory (where topmost .gitignore is)
 */
function loadIgnorePatterns(baseDir: string): { ig: ReturnType<typeof ignore>; rootDir: string } {
  const ig = ignore()

  // Find all .gitignore files in parent hierarchy
  const gitignores = findAllGitignores(baseDir)
  const rootDir = gitignores.length > 0 && gitignores[0] ? gitignores[0].dir : baseDir

  // Load all .gitignore files (from root down to baseDir)
  for (const { path: gitignorePath } of gitignores) {
    const content = readFileSync(gitignorePath, 'utf8')
    ig.add(content)
  }

  // Load .truecourseignore (tool-specific ignore rules, only from baseDir)
  const truecourseignorePath = join(baseDir, '.truecourseignore')
  if (existsSync(truecourseignorePath)) {
    const content = readFileSync(truecourseignorePath, 'utf8')
    ig.add(content)
  }

  // Always ignore .git directory (never analyze git internals)
  ig.add('.git')

  // Ignore test files and language-specific directories (from language configs)
  for (const pattern of getAllTestPatterns()) ig.add(pattern)
  for (const pattern of getAllIgnorePatterns()) ig.add(pattern)

  return { ig, rootDir }
}

/**
 * Discover all supported source files in a directory
 * Respects .gitignore and .truecourseignore patterns
 */
export function discoverFiles(dir: string): string[] {
  const files: string[] = []
  const { ig, rootDir } = loadIgnorePatterns(dir)

  function traverse(currentPath: string) {
    try {
      const entries = readdirSync(currentPath)

      for (const entry of entries) {
        const fullPath = join(currentPath, entry)
        // Calculate path relative to the root where .gitignore is located
        const relativePath = relative(rootDir, fullPath)
        const stat = statSync(fullPath)

        // Check if path should be ignored
        // For directories, add trailing slash for proper gitignore matching
        const pathToCheck = stat.isDirectory() ? relativePath + '/' : relativePath
        if (ig.ignores(pathToCheck)) {
          continue
        }

        if (stat.isDirectory()) {
          traverse(fullPath)
        } else if (stat.isFile()) {
          // Use detectLanguage to check if file is supported
          if (detectLanguage(fullPath)) {
            files.push(fullPath)
          }
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  traverse(dir)
  return files
}
