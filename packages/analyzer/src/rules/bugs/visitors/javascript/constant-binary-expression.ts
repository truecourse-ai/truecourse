import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, isLiteralNode } from './_helpers.js'

export const constantBinaryExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constant-binary-expression',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) =>
      ['===', '!==', '==', '!=', '+', '-', '*', '/', '%', '**'].includes(c.text)
    )

    if (!left || !right || !operator) return null

    // Both operands must be literals
    if (!isLiteralNode(left) || !isLiteralNode(right)) return null

    // String concatenation of two string literals is fine (minifier output)
    if (left.type === 'string' && right.type === 'string' && operator.text === '+') return null

    // Numeric math on two numbers is fine (compile-time constant)
    if (left.type === 'number' && right.type === 'number') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Constant binary expression',
      `\`${node.text}\` is a constant expression that always produces the same result.`,
      sourceCode,
      'Replace with the computed value or fix the operands.',
    )
  },
}
