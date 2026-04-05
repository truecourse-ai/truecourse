import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: logging.exception() called without exception context
// (i.e., outside an except block or without exc_info=True)
export const pythonLoggingExceptionNoExcInfoVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/logging-exception-no-exc-info',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    let isLoggingException = false

    if (func.type === 'attribute') {
      const attr = func.childForFieldName('attribute')
      if (attr?.text !== 'exception') return null

      const obj = func.childForFieldName('object')
      // Match: logging.exception, logger.exception, log.exception
      if (obj?.text === 'logging' || obj?.text === 'logger' || obj?.text === 'log') {
        isLoggingException = true
      }
    }

    if (!isLoggingException) return null

    // Check if we're inside an except block
    let parent = node.parent
    let insideExcept = false
    while (parent) {
      if (parent.type === 'except_clause') {
        insideExcept = true
        break
      }
      // Stop at function boundary
      if (parent.type === 'function_definition') break
      parent = parent.parent
    }

    if (insideExcept) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'logging.exception() outside except handler',
      '`logging.exception()` called outside an `except` block — no exception is active, so `exc_info` will be empty or misleading.',
      sourceCode,
      'Move `logging.exception()` inside an `except` block, or use `logging.error()` if you don\'t need exception info.',
    )
  },
}
