import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const invertedBooleanVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/inverted-boolean',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children[0]
    if (op?.text !== '!') return null

    const operand = node.namedChildren[0]
    if (!operand) return null

    // `!!x` is idiomatic JS for boolean coercion — skip it
    // Only flag the truly confusing `!(!x)` form below

    if (operand.type === 'parenthesized_expression') {
      const inner = operand.namedChildren[0]
      if (inner?.type === 'unary_expression' && inner.children[0]?.text === '!') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Double negation',
          '`!(!x)` is equivalent to `!!x` — use the original value directly or `Boolean(x)`.',
          sourceCode,
          'Remove the double negation and use the value directly.',
        )
      }
    }
    return null
  },
}
