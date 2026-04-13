import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isScriptLikeFile } from '../../../_shared/python-helpers.js'

export const pythonPrintVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/console-log',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Skip test files — check filename only (test_*, *_test.py, conftest.py).
    const fileName = filePath.split('/').pop()?.toLowerCase() ?? ''
    if (fileName.startsWith('test_') || fileName.endsWith('_test.py') || fileName === 'conftest.py') return null

    // Skip script-like files — print() is the legitimate output channel.
    if (isScriptLikeFile(node, filePath)) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type === 'identifier' && fn.text === 'print') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'print() call',
        'print() should be removed or replaced with a proper logger (e.g., logging module) in production code.',
        sourceCode,
        'Replace print() with logging.info() or logging.debug(), or remove it.',
      )
    }

    if (fn.type === 'attribute') {
      const obj = fn.childForFieldName('object')
      const attr = fn.childForFieldName('attribute')
      if (obj?.text === 'logging' && attr?.text === 'debug') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'logging.debug() call',
          'logging.debug() calls may be too verbose for production. Consider removing or raising the log level.',
          sourceCode,
          'Remove logging.debug() or change to logging.info() for production.',
        )
      }
    }

    return null
  },
}
