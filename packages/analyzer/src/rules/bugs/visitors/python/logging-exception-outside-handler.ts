import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Heuristic: true if the object text looks like a logging object.
 * Matches: `logging`, `logger`, `log`, `self.logger`, `self.log`,
 * `cls.logger`, `self._logger`, etc.
 * Does NOT match: `future`, `task`, `outcome`, `retry_state.outcome`, etc.
 */
function isLoggerObject(objText: string): boolean {
  // Direct `logging` module
  if (objText === 'logging') return true
  // Get the final dotted name part
  const parts = objText.split('.')
  const last = parts[parts.length - 1]
  // Common logger variable names (with or without leading underscores)
  const cleaned = last.replace(/^_+/, '')
  if (cleaned === 'logger' || cleaned === 'log' || cleaned === 'logging') return true
  return false
}

/**
 * Detects logging.exception() or exc_info=True used outside an except block.
 * These only make sense inside exception handlers.
 */
export const pythonLoggingExceptionOutsideHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/logging-exception-outside-handler',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    if (func.type !== 'attribute') return null

    const attr = func.childForFieldName('attribute')
    const obj = func.childForFieldName('object')
    if (!attr || !obj) return null

    const attrName = attr.text
    const isExceptionMethod = attrName === 'exception'
    let hasExcInfo = false

    if (isExceptionMethod) {
      // Only flag when the object is a logger — `logging.exception()`,
      // `logger.exception()`, `self.logger.exception()`, `cls.logger.exception()`.
      // Do NOT flag `.exception()` on arbitrary objects like `Future.exception()`,
      // `retry_state.outcome.exception()`, etc.
      const objText = obj.text
      if (!isLoggerObject(objText)) return null
    }

    if (!isExceptionMethod) {
      // Check for exc_info=True keyword argument
      const args = node.childForFieldName('arguments')
      if (!args) return null

      hasExcInfo = args.namedChildren.some((arg) => {
        if (arg.type === 'keyword_argument') {
          const key = arg.childForFieldName('name')
          const value = arg.childForFieldName('value')
          return key?.text === 'exc_info' && (value?.text === 'True' || value?.text === '1')
        }
        return false
      })

      if (!hasExcInfo) return null
    }

    // Check if we're inside an except clause
    let parent = node.parent
    let enclosingFuncName = ''
    while (parent) {
      if (parent.type === 'except_clause') return null // We're inside an exception handler — OK
      if (parent.type === 'function_definition') {
        enclosingFuncName = parent.childForFieldName('name')?.text ?? ''
        break
      }
      if (parent.type === 'class_definition' || parent.type === 'module') break
      parent = parent.parent
    }

    // Skip functions that are clearly error-handling helpers — they're called
    // exclusively from except blocks but the AST can't see the call site.
    if (/^_?(?:handle|log|report|on)_(?:error|exception|failure|integrity)/i.test(enclosingFuncName)) return null

    const loggerText = obj.text
    const callText = `${loggerText}.${attrName}`

    if (isExceptionMethod) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'logging.exception() called outside except handler',
        `\`${callText}()\` is called outside an \`except\` block — there is no active exception to log, so the traceback will be \`NoneType: None\`.`,
        sourceCode,
        `Move \`${callText}()\` inside an \`except\` block, or use \`${loggerText}.error()\` instead.`,
      )
    } else {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'exc_info=True used outside except handler',
        `\`${callText}(..., exc_info=True)\` is called outside an \`except\` block — there is no active exception to capture.`,
        sourceCode,
        `Move the logging call inside an \`except\` block, or remove \`exc_info=True\`.`,
      )
    }
  },
}
