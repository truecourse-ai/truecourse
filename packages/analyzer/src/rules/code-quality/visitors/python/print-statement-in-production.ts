import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonPrintStatementInProductionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/print-statement-in-production',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Skip test files
    const lower = filePath.toLowerCase()
    if (lower.includes('/test') || lower.includes('_test') || lower.includes('test_')) return null

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
