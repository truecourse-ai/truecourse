import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonVerboseLogMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/verbose-log-message',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'exception') return null

    const obj = fn.childForFieldName('object')
    const objText = obj?.text || ''
    if (!['logging', 'logger', 'log', 'LOGGER', 'LOG'].includes(objText) && !objText.toLowerCase().includes('log')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const positional = args.namedChildren.filter((a) => a.type !== 'keyword_argument')
    if (positional.length < 2) return null

    // Check if any argument is str(e) or e.args or e.message
    for (const arg of positional.slice(1)) {
      if (arg.type === 'call') {
        const argFn = arg.childForFieldName('function')
        if (argFn?.text === 'str') {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Verbose exception log message',
            '`logging.exception()` already includes the exception message — passing `str(e)` is redundant.',
            sourceCode,
            'Remove the exception string argument from `logging.exception()`.',
          )
        }
      }
      if (arg.type === 'attribute') {
        const attrNode = arg.childForFieldName('attribute')
        if (attrNode?.text === 'args' || attrNode?.text === 'message') {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Verbose exception log message',
            '`logging.exception()` already includes the exception details — passing `e.args` or `e.message` is redundant.',
            sourceCode,
            'Remove the exception attribute argument from `logging.exception()`.',
          )
        }
      }
    }
    return null
  },
}
