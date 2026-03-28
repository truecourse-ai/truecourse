/**
 * LSP server registry — maps languages to their server configurations.
 *
 * When adding a new language:
 * 1. Create a server config file (e.g., omnisharp.ts for C#)
 * 2. Register it here
 *
 * JS/TS uses the TypeScript Compiler API (in-process), not LSP — so no entry here.
 */

import type { SupportedLanguage } from '@truecourse/shared'
import type { LspServerConfig } from '../lsp-client.js'
import { createPyrightConfig } from './pyright.js'

const LSP_SERVER_FACTORIES: Partial<Record<SupportedLanguage, () => LspServerConfig>> = {
  python: createPyrightConfig,
  // Future:
  // csharp: createOmniSharpConfig,
  // go: createGoplsConfig,
  // rust: createRustAnalyzerConfig,
  // php: createIntelephenseConfig,
}

/**
 * Get the LSP server config for a language, or null if the language
 * uses in-process analysis (JS/TS) or has no LSP server configured.
 */
export function getLspServerConfig(language: SupportedLanguage): LspServerConfig | null {
  const factory = LSP_SERVER_FACTORIES[language]
  return factory ? factory() : null
}

/**
 * Check if a language has an LSP server registered.
 */
export function hasLspServer(language: SupportedLanguage): boolean {
  return language in LSP_SERVER_FACTORIES
}
