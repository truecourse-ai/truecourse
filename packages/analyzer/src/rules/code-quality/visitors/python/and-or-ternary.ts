import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAndOrTernaryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/and-or-ternary',
  languages: ['python'],
  nodeTypes: ['boolean_operator'],
  visit(node, filePath, sourceCode) {
    // Pattern: (x and y) or z
    // The outer is 'or', the left side is 'and'
    const hasOr = node.children.some((c) => c.text === 'or')
    if (!hasOr) return null

    const left = node.namedChildren[0]
    if (!left || left.type !== 'boolean_operator') return null

    const hasAnd = left.children.some((c) => c.text === 'and')
    if (!hasAnd) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'and/or used as ternary',
      '`x and y or z` is a legacy Python ternary pattern. If `y` is falsy, it returns `z` even when `x` is truthy — this is a subtle bug.',
      sourceCode,
      'Replace `x and y or z` with the explicit ternary `y if x else z`.',
    )
  },
}
