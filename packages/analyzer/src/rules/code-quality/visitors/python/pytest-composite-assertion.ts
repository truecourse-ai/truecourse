import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPytestCompositeAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pytest-composite-assertion',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    // assert_statement: assert <expression> [, <message>]
    const expr = node.namedChildren[0]
    if (!expr) return null

    // Check if the expression contains a boolean_operator (and/or)
    if (expr.type === 'boolean_operator') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Composite pytest assertion',
        'This assertion combines multiple conditions with `and`/`or`. When it fails, it\'s unclear which part failed.',
        sourceCode,
        'Split into separate assert statements, one condition per assert, for clearer failure messages.',
      )
    }

    return null
  },
}
