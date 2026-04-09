import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAssertInProductionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/assert-in-production',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    // Skip test files — check the file name (basename) and immediate directory, not the whole path
    const segments = filePath.split('/')
    const fileName = segments[segments.length - 1]?.toLowerCase() ?? ''
    const dirName = segments[segments.length - 2]?.toLowerCase() ?? ''
    if (
      fileName.includes('test_') || fileName.includes('_test.') || fileName.startsWith('test.') ||
      dirName === 'test' || dirName === 'tests' || dirName === '__tests__' ||
      /\btest(s|ing)?\b/.test(dirName)
    ) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Assert in production code',
      '`assert` statements are disabled when Python runs with the `-O` (optimize) flag — do not use them for validation.',
      sourceCode,
      'Replace `assert` with explicit `if` + `raise` for production validation logic.',
    )
  },
}
