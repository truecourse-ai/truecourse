import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPrintStatementInProductionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/print-statement-in-production',
  languages: ['python'],
  nodeTypes: ['call'],
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

    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'print') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'print() in production code',
      '`print()` should not be used in production code — use the `logging` module for structured output with log levels.',
      sourceCode,
      'Replace `print()` with `logging.debug()`, `logging.info()`, etc.',
    )
  },
}
