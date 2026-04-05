import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonTypeCheckWithoutTypeErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/type-check-without-type-error',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // Check if condition is a type check: not isinstance(x, T) or type(x) != T
    let isTypeCheck = false
    const condText = condition.text

    if (condition.type === 'not_operator') {
      const inner = condition.namedChildren[0]
      if (inner?.type === 'call') {
        const fn = inner.childForFieldName('function')
        if (fn?.text === 'isinstance') isTypeCheck = true
      }
    } else if (condition.type === 'comparison_operator') {
      // type(x) != T
      const left = condition.namedChildren[0]
      if (left?.type === 'call') {
        const fn = left.childForFieldName('function')
        if (fn?.text === 'type') isTypeCheck = true
      }
    }

    if (!isTypeCheck) return null

    // Check what's raised in the body
    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null

    for (const stmt of consequence.namedChildren) {
      if (stmt.type !== 'raise_statement') continue
      const expr = stmt.namedChildren[0]
      if (!expr) continue

      const fnNode = expr.type === 'call' ? expr.childForFieldName('function') : expr
      const raisedType = fnNode?.text || ''

      // It should be raising TypeError for type checks
      if (raisedType && raisedType !== 'TypeError' && !raisedType.endsWith('TypeError')) {
        return makeViolation(
          this.ruleKey, stmt, filePath, 'low',
          'Type check without TypeError',
          `Type check raises \`${raisedType}\` instead of \`TypeError\` — type checking violations should raise \`TypeError\`.`,
          sourceCode,
          'Replace with `raise TypeError(...)` to follow Python conventions for type checking.',
        )
      }
    }
    return null
  },
}
