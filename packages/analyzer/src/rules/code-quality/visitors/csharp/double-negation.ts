import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `!!flag` — unlike JS, C# has no truthiness coercion, so a double negation
 * is always a no-op on a bool expression.
 */
export const csharpDoubleNegationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/double-negation',
  languages: ['csharp'],
  nodeTypes: ['prefix_unary_expression'],
  visit(node, filePath, sourceCode) {
    if (node.children[0]?.type !== '!') return null
    const operand = node.namedChildren[0]
    if (operand?.type !== 'prefix_unary_expression') return null
    if (operand.children[0]?.type !== '!') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Double negation',
      '`!!` on a boolean expression is a no-op in C#. Use the value directly.',
      sourceCode,
      'Remove the double negation and use the boolean value directly.',
    )
  },
}
