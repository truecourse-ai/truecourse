import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csharpNoReturnAssignVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-return-assign',
  languages: ['csharp'],
  nodeTypes: ['return_statement'],
  visit(node, filePath, sourceCode) {
    let expr = node.namedChildren[0]
    if (expr?.type === 'parenthesized_expression') expr = expr.namedChildren[0]
    if (expr?.type !== 'assignment_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Assignment in return',
      'Assignment expression inside a `return` statement is confusing — it looks like a comparison.',
      sourceCode,
      'Assign the value to the variable on its own line, then `return` the variable.',
    )
  },
}
