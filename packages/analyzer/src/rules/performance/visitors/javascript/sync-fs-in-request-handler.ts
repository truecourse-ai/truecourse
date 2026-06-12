import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { SYNC_FS_METHODS, isInsideAsyncFunctionOrHandler } from './_helpers.js'

// Seed / database-bootstrap scripts run once at local setup and aren't on
// any request path, so sync FS calls there don't block a hot event loop.
// Matches a `seed/`/`seeds/` directory segment, or a basename starting with
// `seed` or ending in `-seed`/`.seed` (etc.) — same shape used by
// bugs/await-in-loop.
const SEED_FILE_PATH_PATTERN = /(?:^|[\\/])(?:seed|seeds)[\\/]|(?:^|[\\/])seed[^\\/]*\.(?:ts|tsx|js|jsx|mjs|cjs)$|[-_.](?:seed|seeds)\.(?:ts|tsx|js|jsx|mjs|cjs)$/i

// Factory / init-style function names that typically run once at startup —
// transports, signers, clients, etc. Sync FS inside them blocks once at boot,
// not on a hot request path, so flagging is noise. Conservative on purpose:
// generic prefixes like `load` / `make` / `build` are too ambiguous (could
// equally name per-request code) and stay out of the set.
const INIT_NAME_PATTERN = /^(create|init|initialize|setup|bootstrap|configure|register)([A-Z_]|$)/

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
    if (lowerPath.includes('/scripts/') || lowerPath.includes('/bin/') || lowerPath.includes('/cli/')) return null
    if (SEED_FILE_PATH_PATTERN.test(filePath)) return null
    // A file with a shebang (`#!/usr/bin/env node`) is an executable script run
    // directly, not a server module on a request path — dev tooling, one-off
    // utilities, leak detectors, etc. Sync FS there blocks the script's own
    // process, never a shared event loop, so flagging it is noise.
    if (sourceCode.startsWith('#!')) return null

    if (!isInsideAsyncFunctionOrHandler(node)) return null

    const enclosingName = findEnclosingFunctionName(node)
    if (enclosingName && INIT_NAME_PATTERN.test(enclosingName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Synchronous filesystem call in async context',
      `${methodName}() blocks the event loop. Use the async equivalent in request handlers and async functions.`,
      sourceCode,
      `Replace ${methodName}() with its async counterpart (e.g., fs.promises.readFile()).`,
    )
  },
}

// Walks up to the nearest enclosing function and returns its name. For arrow
// functions / function expressions assigned to a const or property, returns
// the binding name (e.g. `createGoogleCloudSigner`). Returns null when no
// name can be recovered.
function findEnclosingFunctionName(node: SyntaxNode): string | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'function_declaration' || current.type === 'method_definition') {
      return current.childForFieldName('name')?.text ?? null
    }
    if (current.type === 'arrow_function' || current.type === 'function') {
      const parent = current.parent
      if (parent?.type === 'variable_declarator') {
        return parent.childForFieldName('name')?.text ?? null
      }
      if (parent?.type === 'pair') {
        const k = parent.childForFieldName('key')
        return k?.text?.replace(/['"`]/g, '') ?? null
      }
      if (parent?.type === 'assignment_expression') {
        const left = parent.childForFieldName('left')
        if (left?.type === 'identifier') return left.text
        if (left?.type === 'member_expression') {
          return left.childForFieldName('property')?.text ?? null
        }
      }
      return null
    }
    current = current.parent
  }
  return null
}
