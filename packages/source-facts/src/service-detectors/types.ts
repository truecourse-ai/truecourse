import type { ServiceType } from '@truecourse/shared'

/**
 * Language-specific service detection logic.
 * Each language can provide:
 * - dependency reading (for framework detection)
 * - library detection heuristics
 */
export interface LanguageServiceDetector {
  /** Read dependencies from language-specific manifest files */
  readDependencies(servicePath: string): string[]
  /** Check if this directory is a library for this language */
  isLibrary(servicePath: string, files: string[], hasApiIndicators: boolean, hasWorkerIndicators: boolean): boolean
  /**
   * Authoritative service type from language manifests (e.g. the .NET project
   * SDK), checked before directory-name heuristics. Return null when the
   * manifest doesn't determine a type.
   */
  detectType?(servicePath: string): ServiceType | null
}
