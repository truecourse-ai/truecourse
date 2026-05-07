import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { SYNC_FS_METHODS, isInsideAsyncFunctionOrHandler } from './_helpers.js'

// Detect the boot-time cached-singleton pattern:
//   let signer: Signer | null = null;
//   const getSigner = async () => {
//     if (signer) return signer;
//     signer = await buildSigner();   // <-- sync fs lives in here
//     return signer;
//   };
// File-level signal: at least one module-level `let <name> = null` (or
// `let <name>: T | null = null`), and the file body contains both a
// "return <name>" early-return guard and a "<name> = " assignment. When
// the source code matches all three the sync fs is part of one-shot
// init, not per-request work.
const SINGLETON_DECL_RE = /^\s*let\s+(\w+)\s*(?::[^=]+)?=\s*null\s*;?\s*$/m
function looksLikeCachedSingletonBoot(_node: SyntaxNode, sourceCode: string): boolean {
  const decl = SINGLETON_DECL_RE.exec(sourceCode)
  if (!decl) return false
  const name = decl[1]
  const guardRe = new RegExp(`\\bif\\s*\\(\\s*${name}\\b[\\s\\S]{0,40}\\breturn\\s+${name}\\b`)
  const assignRe = new RegExp(`\\b${name}\\s*=\\s*await\\b`)
  return guardRe.test(sourceCode) && assignRe.test(sourceCode)
}

export const syncFsInRequestHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/sync-fs-in-request-handler',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (!SYNC_FS_METHODS.has(methodName)) return null

    // Skip standalone scripts (not request handlers)
    const lowerPath = filePath.toLowerCase()
    if (
      lowerPath.includes('/scripts/') ||
      lowerPath.includes('/bin/') ||
      lowerPath.includes('/cli/') ||
      lowerPath.includes('/seed/') ||
      lowerPath.includes('/seeds/') ||
      lowerPath.includes('/seeders/') ||
      lowerPath.includes('/migrations/') ||
      lowerPath.includes('/examples/')
    ) return null
    // Files whose basename indicates a seed/CLI/build entry, even when
    // they live alongside library code: `seed-database.ts`, `seed.ts`,
    // `*.seed.ts`, `cli.ts`, `migrate.ts`. documenso ships
    // `packages/prisma/seed-database.ts` directly under the package
    // root (no /seed/ segment), so the path-segment check above misses
    // it.
    const basename = lowerPath.split('/').pop() ?? ''
    if (/^(seed|seeds|seeder|seed-[\w-]+|migrate|cli)\.[cm]?[jt]sx?$/.test(basename)) return null
    if (/\.seed\.[cm]?[jt]sx?$/.test(basename)) return null

    if (!isInsideAsyncFunctionOrHandler(node)) return null

    // Module-level cached-singleton init pattern. When the enclosing
    // function is a one-shot `await getSigner()` style cache loader
    // (`let signer = null; async function getSigner() { if (signer) return
    // signer; signer = await build(); return signer }`), the sync fs
    // calls inside `build()` execute exactly once at boot — they don't
    // block per-request. Heuristic: when this file declares a
    // module-level `let <name>: T | null = null` AND the function call
    // chain assigns to that name, treat as boot-time init.
    if (looksLikeCachedSingletonBoot(node, sourceCode)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Synchronous filesystem call in async context',
      `${methodName}() blocks the event loop. Use the async equivalent in request handlers and async functions.`,
      sourceCode,
      `Replace ${methodName}() with its async counterpart (e.g., fs.promises.readFile()).`,
    )
  },
}
