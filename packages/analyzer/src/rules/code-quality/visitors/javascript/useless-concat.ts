import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const uselessConcatVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-concat',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '+')
    if (!op) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (left?.type === 'string' && right?.type === 'string') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless string concatenation',
        `Concatenating two string literals ${left.text} + ${right.text} — merge them into one string.`,
        sourceCode,
        'Combine the string literals into a single string.',
      )
    }
    return null
  },
}
