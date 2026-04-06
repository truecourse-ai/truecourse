import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects datetime strftime/strptime format strings using 12-hour clock (%I)
 * without AM/PM marker (%p), or 24-hour clock (%H) with AM/PM marker (%p).
 */
export const pythonDatetime12hFormatWithoutAmpmVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/datetime-12h-format-without-ampm',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    if (func.type !== 'attribute') return null

    const attr = func.childForFieldName('attribute')
    if (!attr) return null

    const methodName = attr.text
    if (methodName !== 'strftime' && methodName !== 'strptime') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const positionalArgs = args.namedChildren.filter((a) => a.type !== 'keyword_argument')
    if (positionalArgs.length === 0) return null

    // For strftime, the format is the first arg; for strptime, the second
    const formatArgIndex = methodName === 'strptime' ? 1 : 0
    const formatArg = positionalArgs[formatArgIndex]
    if (!formatArg || formatArg.type !== 'string') return null

    const formatStr = formatArg.text.replace(/^["']+|["']+$/g, '')

    const has12Hour = formatStr.includes('%I')
    const has24Hour = formatStr.includes('%H')
    const hasAmPm = formatStr.includes('%p')

    if (has12Hour && !hasAmPm) {
      return makeViolation(
        this.ruleKey, formatArg, filePath, 'high',
        'Datetime 12-hour format without AM/PM',
        `The format string uses 12-hour clock (\`%I\`) without an AM/PM marker (\`%p\`) — this produces ambiguous times (e.g., "09:00" could be AM or PM).`,
        sourceCode,
        `Add \`%p\` to the format string, or switch to 24-hour clock using \`%H\`.`,
      )
    }

    if (has24Hour && hasAmPm) {
      return makeViolation(
        this.ruleKey, formatArg, filePath, 'high',
        'Datetime 24-hour format with AM/PM',
        `The format string uses 24-hour clock (\`%H\`) with an AM/PM marker (\`%p\`) — this is contradictory and will produce incorrect output.`,
        sourceCode,
        `Remove \`%p\` from the format string, or switch to 12-hour clock using \`%I\`.`,
      )
    }

    return null
  },
}
