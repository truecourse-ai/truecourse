import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** `!(!x)` — negation of a parenthesized negation. */
export const csharpInvertedBooleanVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/inverted-boolean',
  languages: ['csharp'],
  nodeTypes: ['prefix_unary_expression'],
  visit(node, filePath, sourceCode) {
    if (node.children[0]?.type !== '!') return null
    const operand = node.namedChildren[0]
    if (operand?.type !== 'parenthesized_expression') return null
    const inner = operand.namedChildren[0]
    if (inner?.type !== 'prefix_unary_expression' || inner.children[0]?.type !== '!') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Double negation',
      '`!(!x)` is equivalent to `x` — use the original value directly.',
      sourceCode,
      'Remove the double negation and use the value directly.',
    )
  },
}
