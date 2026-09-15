/**
 * Python import resolver.
 *
 * Handles relative imports (from .module import), absolute dotted imports
 * (from shared.utils import), and __init__.py barrel packages.
 */

import { resolve, dirname } from 'path'
import { PYTHON_CONFIG } from '../language-config.js'

const EXTENSIONS = PYTHON_CONFIG.moduleResolution.extensions
const INDEX_FILES = PYTHON_CONFIG.moduleResolution.indexFiles

export function resolvePythonImport(
  importSource: string,
  containingFile: string,
  rootPath: string,
  analyzedFiles: Set<string>,
): string | null {
  // Relative imports: starts with dots (from . import foo, from ..module import bar)
  if (importSource.startsWith('.')) {
    const fromDir = dirname(containingFile)

    let dots = 0
    while (dots < importSource.length && importSource[dots] === '.') dots++

    const modulePart = importSource.slice(dots)

    let baseDir = fromDir
    for (let i = 1; i < dots; i++) {
      baseDir = dirname(baseDir)
    }

    if (modulePart) {
      const relativePath = modulePart.replace(/\./g, '/')
      const basePath = resolve(baseDir, relativePath)

      for (const ext of EXTENSIONS) {
        const candidate = basePath + ext
        if (analyzedFiles.has(candidate)) return candidate
      }

      for (const indexFile of INDEX_FILES) {
        const candidate = resolve(basePath, indexFile)
        if (analyzedFiles.has(candidate)) return candidate
      }
    } else {
      for (const indexFile of INDEX_FILES) {
        const candidate = resolve(baseDir, indexFile)
        if (analyzedFiles.has(candidate)) return candidate
      }
    }

    return null
  }

  // Absolute dotted imports: from shared.utils.formatters import format_user
  const relativePath = importSource.replace(/\./g, '/')
  const basePath = resolve(rootPath, relativePath)

  for (const ext of EXTENSIONS) {
    const candidate = basePath + ext
    if (analyzedFiles.has(candidate)) return candidate
  }

  for (const indexFile of INDEX_FILES) {
    const candidate = resolve(basePath, indexFile)
    if (analyzedFiles.has(candidate)) return candidate
  }

  return null
}
