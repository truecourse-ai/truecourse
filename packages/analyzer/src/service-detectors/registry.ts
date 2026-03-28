import type { LanguageServiceDetector } from './types.js'
import { jsServiceDetector } from './javascript.js'
import { pythonServiceDetector } from './python.js'

const ALL_DETECTORS: LanguageServiceDetector[] = [
  jsServiceDetector,
  pythonServiceDetector,
]

/**
 * Read dependencies from all language-specific manifest files in a directory.
 */
export function readAllDependencies(servicePath: string): string[] {
  for (const detector of ALL_DETECTORS) {
    const deps = detector.readDependencies(servicePath)
    if (deps.length > 0) return deps
  }
  return []
}

/**
 * Check if a directory is a library for any language.
 */
export function isLanguageLibrary(
  servicePath: string,
  files: string[],
  hasApiIndicators: boolean,
  hasWorkerIndicators: boolean,
): boolean {
  return ALL_DETECTORS.some((d) => d.isLibrary(servicePath, files, hasApiIndicators, hasWorkerIndicators))
}
