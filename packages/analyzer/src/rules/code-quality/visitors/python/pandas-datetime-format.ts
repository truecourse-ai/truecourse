import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { importsPandas } from '../../../_shared/python-framework-detection.js'

/**
 * Detects pd.to_datetime() with dayfirst=True but a date string like "2024-01-15"
 * that doesn't look like day-first format, or yearfirst inconsistencies.
 */
export const pythonPandasDatetimeFormatVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pandas-datetime-format',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    // Gate on file actually using pandas. `to_datetime` is also used by
    // `datetime` and other libraries.
    if (!importsPandas(node)) return null

    const fn = node.childForFieldName('function')
    if (!fn) return null

    // pd.to_datetime() or to_datetime()
    let isToDt = false
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr?.text === 'to_datetime') isToDt = true
    } else if (fn.type === 'identifier' && fn.text === 'to_datetime') {
      isToDt = true
    }
    if (!isToDt) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const kwargs = args.namedChildren.filter((c) => c.type === 'keyword_argument')
    const kwNames = kwargs.map((c) => c.childForFieldName('name')?.text)

    const hasDayfirst = kwNames.includes('dayfirst')
    const hasYearfirst = kwNames.includes('yearfirst')

    if (!hasDayfirst && !hasYearfirst) return null

    // Check if first positional arg is a string literal with YYYY-MM-DD format
    const posArgs = args.namedChildren.filter((c) => c.type !== 'keyword_argument')
    if (posArgs.length === 0) return null
    const firstArg = posArgs[0]

    if (firstArg.type !== 'string') return null
    const dateStr = firstArg.text.slice(1, -1)

    // If date starts with 4-digit year, dayfirst is inconsistent
    if (hasDayfirst && /^\d{4}[-/]/.test(dateStr)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Inconsistent dayfirst=True with ISO date format',
        `\`pd.to_datetime("${dateStr}", dayfirst=True)\` — date string appears ISO format (year-first) but \`dayfirst=True\` is specified.`,
        sourceCode,
        'Remove `dayfirst=True` or use a day-first formatted string like "15/01/2024".',
      )
    }

    return null
  },
}
