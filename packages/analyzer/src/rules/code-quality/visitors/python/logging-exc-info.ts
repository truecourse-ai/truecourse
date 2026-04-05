import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonLoggingExcInfoVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/logging-exc-info-instead-of-exception',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const method = fn.childForFieldName('attribute')

    // logging.error(..., exc_info=True) or logger.error(..., exc_info=True)
    if (!method || method.text !== 'error') return null
    if (!obj) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check for exc_info=True keyword argument
    let hasExcInfoTrue = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        const val = arg.childForFieldName('value')
        if (key?.text === 'exc_info' && val?.text === 'True') {
          hasExcInfoTrue = true
          break
        }
      }
    }

    if (!hasExcInfoTrue) return null

    const objText = obj.text
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use logging.exception instead of logging.error with exc_info',
      `\`${objText}.error(..., exc_info=True)\` should use \`${objText}.exception()\` instead.`,
      sourceCode,
      `Replace \`${objText}.error(..., exc_info=True)\` with \`${objText}.exception(...)\`.`,
    )
  },
}
