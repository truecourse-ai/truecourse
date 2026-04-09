import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { SYNC_FS_METHODS, isInsideAsyncFunctionOrHandler } from './_helpers.js'

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

    if (!isInsideAsyncFunctionOrHandler(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Synchronous filesystem call in async context',
      `${methodName}() blocks the event loop. Use the async equivalent in request handlers and async functions.`,
      sourceCode,
      `Replace ${methodName}() with its async counterpart (e.g., fs.promises.readFile()).`,
    )
  },
}
