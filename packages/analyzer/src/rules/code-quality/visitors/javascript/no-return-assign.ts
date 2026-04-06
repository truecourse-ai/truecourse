import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noReturnAssignVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-return-assign',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['return_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null

    if (expr.type === 'assignment_expression' || expr.type === 'augmented_assignment_expression') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Assignment in return',
        'Assignment expression inside `return` statement is confusing — it looks like a comparison.',
        sourceCode,
        'Assign the value to a variable before the `return`, or wrap in extra parentheses if intentional.',
      )
    }
    if (expr.type === 'parenthesized_expression') {
      const inner = expr.namedChildren[0]
      if (inner?.type === 'assignment_expression' || inner?.type === 'augmented_assignment_expression') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Assignment in return',
          'Assignment expression inside `return` statement is confusing — it looks like a comparison.',
          sourceCode,
          'Assign the value to a variable before the `return`.',
        )
      }
    }
    return null
  },
}
