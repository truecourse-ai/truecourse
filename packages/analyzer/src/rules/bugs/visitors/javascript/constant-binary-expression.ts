import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES, isLiteralNode } from './_helpers.js'

export const constantBinaryExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constant-binary-expression',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression', 'ternary_expression'],
  visit(node, filePath, sourceCode) {
    // Template literals with interpolations are never constant — skip entirely
    if (node.type === 'binary_expression') {
      const left = node.childForFieldName('left')
      const right = node.childForFieldName('right')
      if (left?.type === 'template_string' || right?.type === 'template_string') return null
    }

    // For ternary expressions: skip when the test is a runtime identifier (not a compile-time constant)
    if (node.type === 'ternary_expression') {
      const condition = node.childForFieldName('condition')
      if (condition && condition.type === 'identifier') return null
      // Only flag ternaries where condition is a literal
      if (!condition || !isLiteralNode(condition)) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Constant ternary expression',
        `\`${node.text}\` has a constant condition that always evaluates to the same branch.`,
        sourceCode,
        'Replace with the value of the branch that is always taken.',
      )
    }
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
