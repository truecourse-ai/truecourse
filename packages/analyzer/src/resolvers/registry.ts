/**
 * Import resolver registry — maps languages to their resolver functions.
 *
 * JS/TS uses the TypeScript Compiler API (handled separately in dependency-graph.ts).
 * Other languages register their resolvers here.
 */

import type { FileAnalysis, ModuleDependency, SupportedLanguage } from '@truecourse/shared'
import { resolvePythonImport } from './python.js'
import { contributeCSharpEdges } from '../symbol-index/csharp-symbol-index.js'

type ImportResolver = (
  importSource: string,
  containingFile: string,
  rootPath: string,
  analyzedFiles: Set<string>,
) => string | null

const RESOLVERS: Partial<Record<SupportedLanguage, ImportResolver>> = {
  python: resolvePythonImport,
  // Future:
  // go: resolveGoImport,
}

/**
 * Get the import resolver for a language, or null if the language
 * uses the TS compiler (JS/TS) or has no custom resolver.
 */
export function getImportResolver(language: SupportedLanguage): ImportResolver | null {
  return RESOLVERS[language] || null
}

/**
 * Edge contributors — for languages whose cross-file dependencies don't map
 * 1:1 onto import statements. A contributor sees every file of its language
 * at once and returns file-level edges directly; those files are then skipped
 * by the per-import resolution loop.
 *
 * C# is the motivating case: a type can reference a type in the same (or an
 * ancestor) namespace across files with no `using` directive at all, so its
 * edges come from the symbol index, not from imports.
 */
type EdgeContributor = (files: FileAnalysis[], rootPath: string) => ModuleDependency[]

const EDGE_CONTRIBUTORS: Partial<Record<SupportedLanguage, EdgeContributor>> = {
  csharp: contributeCSharpEdges,
}

export function getEdgeContributor(language: SupportedLanguage): EdgeContributor | null {
  return EDGE_CONTRIBUTORS[language] || null
}
