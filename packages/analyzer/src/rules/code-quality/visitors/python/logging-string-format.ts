import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const LOGGING_METHODS = new Set(['debug', 'info', 'warning', 'error', 'critical', 'exception', 'log'])

export const pythonLoggingStringFormatVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/logging-string-format',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || !LOGGING_METHODS.has(attr.text)) return null

    const obj = fn.childForFieldName('object')
    const objText = obj?.text || ''
    if (!['logging', 'logger', 'log', 'LOGGER', 'LOG'].includes(objText) && !objText.toLowerCase().includes('log')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null
    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Check if using f-string, .format(), %, or + concatenation
    if (firstArg.type === 'formatted_string') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'f-string in logging call',
        'Using an f-string in a logging call always formats the string even if the log level is disabled. Use lazy % formatting instead.',
        sourceCode,
        'Replace f-string with lazy % formatting: `logging.info("msg %s", value)`.',
      )
    }

    if (firstArg.type === 'call') {
      const innerFn = firstArg.childForFieldName('function')
      if (innerFn?.type === 'attribute' && innerFn.childForFieldName('attribute')?.text === 'format') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'String .format() in logging call',
          'Using `.format()` in a logging call always formats the string. Use lazy % formatting instead.',
          sourceCode,
          'Replace `.format()` with lazy % formatting: `logging.info("msg %s", value)`.',
        )
      }
    }

    if (firstArg.type === 'binary_operator') {
      const op = firstArg.children.find((c) => c.type === '+' || c.type === '%')
      if (op?.type === '+') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'String concatenation in logging call',
          'Using `+` in a logging call always concatenates. Use lazy % formatting instead.',
          sourceCode,
          'Replace string concatenation with lazy % formatting: `logging.info("msg %s", value)`.',
        )
      }
      if (op?.type === '%') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'String % formatting in logging call',
          'Using `%` formatting in a logging call always formats. Pass the format string and args separately.',
          sourceCode,
          'Pass format string and args separately: `logging.info("msg %s", value)`.',
        )
      }
    }

    return null
  },
}
