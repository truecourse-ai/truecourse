import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isScriptLikeFile } from '../../../_shared/python-helpers.js'

export const pythonPrintStatementInProductionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/print-statement-in-production',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Skip test files — check filename only (test_*, *_test.py, conftest.py).
    // Don't check directory because many projects have non-test files in test/.
    const fileName = filePath.split('/').pop()?.toLowerCase() ?? ''
    if (fileName.startsWith('test_') || fileName.endsWith('_test.py') || fileName === 'conftest.py') return null

    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'print') return null

    // Skip ALL print() calls in script-like files (scripts, CLI tools, entry
    // points) where print is the legitimate user-facing output channel.
    if (isScriptLikeFile(node, filePath)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'print() in production code',
      '`print()` should not be used in production code — use the `logging` module for structured output with log levels.',
      sourceCode,
      'Replace `print()` with `logging.debug()`, `logging.info()`, etc.',
    )
  },
}
