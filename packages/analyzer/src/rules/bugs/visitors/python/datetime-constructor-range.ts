import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects datetime/date/time constructor calls with out-of-range literal values.
 * S6882: datetime constructor with invalid values raises ValueError at runtime.
 */

// datetime(year, month, day, hour=0, minute=0, second=0, microsecond=0)
const DATETIME_RANGES: Record<string, [number, number]> = {
  month: [1, 12],
  day: [1, 31],
  hour: [0, 23],
  minute: [0, 59],
  second: [0, 59],
  microsecond: [0, 999999],
}

// date(year, month, day)
// time(hour=0, minute=0, second=0, microsecond=0)

function extractIntLiteral(node: import('tree-sitter').SyntaxNode): number | null {
  if (node.type === 'integer') {
    const val = parseInt(node.text, 10)
    return isNaN(val) ? null : val
  }
  if (node.type === 'unary_operator') {
    const op = node.children[0]?.text
    const operand = node.namedChildren[0]
    if (op === '-' && operand?.type === 'integer') {
      return -parseInt(operand.text, 10)
    }
  }
  return null
}

export const pythonDatetimeConstructorRangeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/datetime-constructor-range',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcText = func.text
    // Match datetime.datetime, datetime.date, datetime.time, or bare datetime/date/time
    const isDatetime = funcText === 'datetime' || funcText === 'datetime.datetime' || funcText.endsWith('.datetime')
    const isDate = funcText === 'date' || funcText === 'datetime.date' || funcText.endsWith('.date')
    const isTime = funcText === 'time' || funcText === 'datetime.time' || funcText.endsWith('.time')

    if (!isDatetime && !isDate && !isTime) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check keyword arguments for out-of-range values
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (!key || !value) continue

        const paramName = key.text
        const range = DATETIME_RANGES[paramName]
        if (!range) continue

        const val = extractIntLiteral(value)
        if (val === null) continue

        const [min, max] = range
        if (val < min || val > max) {
          return makeViolation(
            this.ruleKey, arg, filePath, 'high',
            'Invalid datetime constructor value',
            `\`${funcText}(${paramName}=${val})\` — \`${paramName}\` must be between ${min} and ${max}, but got ${val}. This will raise a \`ValueError\` at runtime.`,
            sourceCode,
            `Use a valid value for \`${paramName}\` between ${min} and ${max}.`,
          )
        }
      }
    }

    // Check positional arguments for datetime/date
    if (isDatetime || isDate) {
      const positional = args.namedChildren.filter((c) => c.type !== 'keyword_argument')
      // Positions: year[0], month[1], day[2], hour[3], minute[4], second[5], microsecond[6]
      const paramOrder = isDatetime
        ? ['year', 'month', 'day', 'hour', 'minute', 'second', 'microsecond']
        : ['year', 'month', 'day']

      for (let i = 1; i < positional.length && i < paramOrder.length; i++) {
        const paramName = paramOrder[i]
        const range = DATETIME_RANGES[paramName]
        if (!range) continue

        const val = extractIntLiteral(positional[i])
        if (val === null) continue

        const [min, max] = range
        if (val < min || val > max) {
          return makeViolation(
            this.ruleKey, positional[i], filePath, 'high',
            'Invalid datetime constructor value',
            `\`${funcText}\` argument ${i + 1} (\`${paramName}\`) value ${val} is out of range [${min}, ${max}]. This will raise a \`ValueError\` at runtime.`,
            sourceCode,
            `Use a valid value for \`${paramName}\` between ${min} and ${max}.`,
          )
        }
      }
    }

    return null
  },
}
