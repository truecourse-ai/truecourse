import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const setTimeoutNoStoreVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/settimeout-setinterval-no-clear',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'call_expression') return null

    const fn = expr.childForFieldName('function')
    if (!fn || fn.type !== 'identifier') return null
    // Only flag setInterval — setTimeout without storing ID is standard for fire-and-forget delays
    if (fn.text !== 'setInterval') return null

    // If the expression_statement directly calls setTimeout/setInterval without assignment,
    // the return value (timer ref) is lost
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `${fn.text}() without storing reference`,
      `${fn.text}() called without storing the return value. The timer cannot be cleared later, which may cause memory leaks.`,
      sourceCode,
      `Store the return value: const timerId = ${fn.text}(...) and clear it when no longer needed.`,
    )
  },
}
