import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noVoidVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-void',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.children[0]
    if (operator?.text !== 'void') return null
    const operand = node.children[1]
    if (operand?.text === '0') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Void expression',
      'The `void` operator is confusing. Use `undefined` directly or omit the return value.',
      sourceCode,
      'Replace `void expr` with `undefined` or remove the expression.',
    )
  },
}
