import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const floatingPromiseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/floating-promise',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    // Look for expression statements containing a call expression that likely returns a promise
    const expr = node.namedChildren[0]
    if (!expr) return null

    // If the expression is already an await, it's fine
    if (expr.type === 'await_expression') return null

    // If it's a call expression, check if it looks like a promise
    if (expr.type !== 'call_expression') return null

    const fn = expr.childForFieldName('function')
    if (!fn) return null

    // Already has .catch() or .then() → fine
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop?.text === 'catch' || prop?.text === 'then' || prop?.text === 'finally') return null
    }

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) funcName = prop.text
    }

    // Heuristic: only flag commonly known async patterns
    const ASYNC_PREFIXES = ['fetch', 'save', 'send', 'delete', 'update', 'create', 'remove', 'upload', 'download', 'load']
    const isLikelyAsync = ASYNC_PREFIXES.some((p) => funcName.toLowerCase().startsWith(p))

    if (!isLikelyAsync) return null

    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Floating promise',
      `${funcName}() likely returns a Promise that is not awaited or .catch()-ed.`,
      sourceCode,
      'Either await the promise or add .catch() to handle rejections.',
    )
  },
}
