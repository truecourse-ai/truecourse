import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonLoggingDeprecatedWarnVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/logging-deprecated-warn',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcText = func.text

    // logging.warn() or logger.warn()
    if (func.type !== 'attribute') return null

    const attr = func.childForFieldName('attribute')
    if (!attr || attr.text !== 'warn') return null

    const obj = func.childForFieldName('object')
    if (!obj) return null

    const objText = obj.text
    if (objText !== 'logging' && !objText.match(/^(log|logger|LOG|LOGGER|app\.logger)$/)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Deprecated logging.warn() usage',
      `\`${funcText}\` is deprecated — use \`${objText}.warning()\` instead. The \`warn\` method will be removed in a future Python version.`,
      sourceCode,
      `Replace \`${funcText}()\` with \`${objText}.warning()\`.`,
    )
  },
}
