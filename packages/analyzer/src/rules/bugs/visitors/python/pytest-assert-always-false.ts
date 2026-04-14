import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isPythonTestFile } from '../../../_shared/python-helpers.js'

/**
 * Detects `assert False` in test code.
 * Should use pytest.fail() instead for better output.
 */
export const pythonPytestAssertAlwaysFalseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/pytest-assert-always-false',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.namedChildren[0]
    if (!condition) return null

    // Check for `assert False` or `assert false`
    if (condition.type !== 'false') return null

    // Only flag in test files
    if (!isPythonTestFile(filePath)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'pytest assert always false',
      '`assert False` unconditionally fails — use `pytest.fail()` instead for better error messages and output.',
      sourceCode,
      'Replace `assert False` with `pytest.fail("reason")` to provide a descriptive failure message.',
    )
  },
}
