import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonLoggingRedundantExcInfoVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/logging-redundant-exc-info',
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

    const hasExcInfo = args.namedChildren.some((a) => {
      if (a.type !== 'keyword_argument') return false
      const key = a.childForFieldName('name')
      const val = a.childForFieldName('value')
      return key?.text === 'exc_info' && val?.text === 'True'
    })

    if (!hasExcInfo) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant exc_info in logging.exception()',
      '`logging.exception()` already includes `exc_info=True` by default — the explicit argument is redundant.',
      sourceCode,
      'Remove the `exc_info=True` argument from `logging.exception()`.',
    )
  },
}
