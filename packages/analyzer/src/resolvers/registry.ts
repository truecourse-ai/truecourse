/**
 * Import resolver registry — maps languages to their resolver functions.
 *
 * JS/TS uses the TypeScript Compiler API (handled separately in dependency-graph.ts).
 * Other languages register their resolvers here.
 */

import type { SupportedLanguage } from '@truecourse/shared'
import { resolvePythonImport } from './python.js'

type ImportResolver = (
  importSource: string,
  containingFile: string,
  rootPath: string,
  analyzedFiles: Set<string>,
) => string | null

const RESOLVERS: Partial<Record<SupportedLanguage, ImportResolver>> = {
  python: resolvePythonImport,
  // Future:
  // csharp: resolveCSharpImport,
  // go: resolveGoImport,
}

/**
 * Get the import resolver for a language, or null if the language
 * uses the TS compiler (JS/TS) or has no custom resolver.
 */
export function getImportResolver(language: SupportedLanguage): ImportResolver | null {
  return RESOLVERS[language] || null
}
