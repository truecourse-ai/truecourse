import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const meaninglessVoidOperatorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/meaningless-void-operator',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator') ?? node.children.find((c) => c.type === 'void')
    if (!op || op.text !== 'void') return null

    // void is "meaningful" when used in statement position to discard a value
    // It's "meaningless" when used in non-statement position (e.g., expression context inside other expressions)
    const parent = node.parent
    if (!parent) return null

    // If the parent is an expression_statement, void is being used to discard — that's fine
    if (parent.type === 'expression_statement') return null
    // If used in arrow function body as a type-safe way to discard a value, that's also acceptable
    if (parent.type === 'arrow_function') return null
    // If used in a ternary/logical to ensure void return
    if (parent.type === 'ternary_expression' || parent.type === 'logical_expression') return null

    // In other positions (e.g., assignment, return, comparison), it's confusing
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Meaningless void operator',
      '`void` operator used in a non-statement position — the result is always `undefined`. This is likely unintentional.',
      sourceCode,
      'Remove the `void` operator or use it in statement position only.',
    )
  },
}
