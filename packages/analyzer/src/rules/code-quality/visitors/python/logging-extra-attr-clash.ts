import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// LogRecord built-in attributes that would clash
const LOG_RECORD_ATTRS = new Set([
  'args', 'created', 'exc_info', 'exc_text', 'filename', 'funcName', 'levelname',
  'levelno', 'lineno', 'message', 'module', 'msecs', 'msg', 'name', 'pathname',
  'process', 'processName', 'relativeCreated', 'stack_info', 'thread', 'threadName',
])

export const pythonLoggingExtraAttrClashVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/logging-extra-attr-clash',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Check if it's a logging call
    let isLoggingCall = false
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      const methods = new Set(['debug', 'info', 'warning', 'error', 'critical', 'exception', 'log'])
      if (attr && methods.has(attr.text)) {
        const objText = obj?.text || ''
        if (objText === 'logging' || objText.toLowerCase().includes('log') || objText === 'logger') {
          isLoggingCall = true
        }
      }
    }
    if (!isLoggingCall) return null

    // Look for extra={"key": ...} argument
    const args = node.childForFieldName('arguments')
    if (!args) return null

    const extraArg = args.namedChildren.find((a) => {
      if (a.type !== 'keyword_argument') return false
      const key = a.childForFieldName('name')
      return key?.text === 'extra'
    })

    if (!extraArg) return null

    const extraVal = extraArg.childForFieldName('value')
    if (!extraVal || extraVal.type !== 'dictionary') return null

    for (const pair of extraVal.namedChildren) {
      if (pair.type !== 'pair') continue
      const keyNode = pair.childForFieldName('key')
      if (!keyNode) continue
      const keyText = keyNode.text.replace(/^['"]|['"]$/g, '') // strip quotes
      if (LOG_RECORD_ATTRS.has(keyText)) {
        return makeViolation(
          this.ruleKey, extraArg, filePath, 'medium',
          'Logging extra attribute clash',
          `logging \`extra\` dict contains key \`"${keyText}"\` which clashes with a built-in \`LogRecord\` attribute.`,
          sourceCode,
          `Rename the key in the \`extra\` dict to avoid clashing with LogRecord attribute \`${keyText}\`.`,
        )
      }
    }
    return null
  },
}
