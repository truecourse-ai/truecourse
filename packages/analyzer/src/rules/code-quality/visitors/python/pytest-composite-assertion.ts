import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPytestCompositeAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pytest-composite-assertion',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    // Only relevant in test files. Outside \`tests/\`,
    // \`__tests__/\`, or files matching \`test_*.py\`/\`*_test.py\`,
    // an \`assert\` is a runtime invariant check and the
    // "split for clearer pytest output" guidance does not apply.
    const isTestFile =
      /(?:[\\/]|^)(?:tests?|__tests__)[\\/]/.test(filePath) ||
      /(?:[\\/]|^)test_[^\\/]+\.py$/.test(filePath) ||
      /_test\.py$/.test(filePath) ||
      /\/conftest\.py$/.test(filePath)
    if (!isTestFile) return null

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
