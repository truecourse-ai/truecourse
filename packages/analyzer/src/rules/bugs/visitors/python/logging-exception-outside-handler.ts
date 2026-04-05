import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

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
    while (parent) {
      if (parent.type === 'except_clause') return null // We're inside an exception handler — OK
      if (
        parent.type === 'function_definition' ||
        parent.type === 'class_definition' ||
        parent.type === 'module'
      ) break
      parent = parent.parent
    }

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
