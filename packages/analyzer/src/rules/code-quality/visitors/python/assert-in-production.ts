import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isPythonTestFile } from '../../../_shared/python-helpers.js'

export const pythonAssertInProductionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/assert-in-production',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    // Skip test files
    if (isPythonTestFile(filePath)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Assert in production code',
      '`assert` statements are disabled when Python runs with the `-O` (optimize) flag — do not use them for validation.',
      sourceCode,
      'Replace `assert` with explicit `if` + `raise` for production validation logic.',
    )
  },
}
