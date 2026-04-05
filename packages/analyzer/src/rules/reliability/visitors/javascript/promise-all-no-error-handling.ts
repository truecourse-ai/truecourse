import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideTryCatch, hasCatchChain } from './_helpers.js'

export const promiseAllNoErrorHandlingVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/promise-all-no-error-handling',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Match Promise.all(), Promise.allSettled() is fine
    if (fn.type !== 'member_expression') return null
    const obj = fn.childForFieldName('object')
    const prop = fn.childForFieldName('property')
    if (obj?.text !== 'Promise' || prop?.text !== 'all') return null

    // Check if inside try/catch or has .catch() chain
    if (isInsideTryCatch(node)) return null
    if (hasCatchChain(node)) return null

    // Check if result is awaited inside try/catch
    const parent = node.parent
    if (parent?.type === 'await_expression' && isInsideTryCatch(parent)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Promise.all without error handling',
      'Promise.all() will reject if any promise rejects. Add .catch() or wrap in try/catch.',
      sourceCode,
      'Add a .catch() handler or wrap the Promise.all() in a try/catch block.',
    )
  },
}
