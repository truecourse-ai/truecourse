/**
 * Pyright language server configuration.
 *
 * Pyright is a Python type checker written in TypeScript/Node.js by Microsoft.
 * It ships as an npm package (`pyright`) with a built-in language server binary
 * (`pyright-langserver`) that communicates via LSP over stdin/stdout.
 *
 * Installation: `pnpm add pyright` in packages/analyzer
 */

import { resolve, dirname } from 'path'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import type { LspServerConfig } from '../lsp-client.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

/**
 * Find the pyright-langserver binary from the installed npm package.
 */
function findPyrightBinary(): string {
  // Walk up from our package to find node_modules with pyright
  let dir = resolve(__dirname, '..')
  for (let i = 0; i < 10; i++) {
    const candidate = resolve(dir, 'node_modules', '.bin', 'pyright-langserver')
    if (existsSync(candidate)) return candidate

    // Also check for the entry JS file directly
    const jsCandidate = resolve(dir, 'node_modules', 'pyright', 'langserver.index.js')
    if (existsSync(jsCandidate)) return jsCandidate

    dir = resolve(dir, '..')
  }

  // Fallback — assume it's on PATH
  return 'pyright-langserver'
}

/**
 * Create a Pyright LSP server configuration.
 */
export function createPyrightConfig(): LspServerConfig {
  const binary = findPyrightBinary()

  // If it's a JS file, run it with node
  const isJsFile = binary.endsWith('.js')

  return {
    name: 'Pyright',
    command: isJsFile ? process.execPath : binary,
    args: isJsFile ? [binary, '--stdio'] : ['--stdio'],
    initializationOptions: {
      // Pyright-specific settings
      pythonPath: undefined, // Auto-detect
    },
  }
}
