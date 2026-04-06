import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects invalid NumPy busdaycalendar weekmask values.
 * S6900: The weekmask argument must be a 7-character string of '0's and '1's,
 * or one of the named day abbreviations.
 */

const VALID_NAMED_WEEKMASKS = new Set([
  'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
  'Mon Tue', 'Mon Tue Wed', 'Mon Tue Wed Thu', 'Mon Tue Wed Thu Fri',
  '1111100', '1111110', '1111111', '0000000',
])

function isValidWeekdayString(s: string): boolean {
  // 7-char binary string
  if (/^[01]{7}$/.test(s)) return true
  // Space-separated day names
  const days = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
  if (s.split(' ').every((d) => days.has(d))) return true
  return false
}

export const pythonNumpyWeekmaskInvalidVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/numpy-weekmask-invalid',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcText = func.text
    // numpy.busdaycalendar or np.busdaycalendar
    if (!funcText.endsWith('busdaycalendar')) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Find weekmask argument (positional or keyword)
    let weekmaskNode = null

    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        if (key?.text === 'weekmask') {
          weekmaskNode = arg.childForFieldName('value')
        }
      } else if (!weekmaskNode && (arg.type === 'string' || arg.type === 'concatenated_string')) {
        weekmaskNode = arg
      }
    }

    if (!weekmaskNode || weekmaskNode.type !== 'string') return null

    // Extract string value
    const raw = weekmaskNode.text
    const value = raw.replace(/^["']|["']$/g, '').replace(/^"""[\s\S]*?"""$/, (m) => m.slice(3, -3))

    if (!isValidWeekdayString(value)) {
      return makeViolation(
        this.ruleKey, weekmaskNode, filePath, 'high',
        'Invalid NumPy weekmask value',
        `\`numpy.busdaycalendar\` weekmask \`"${value}"\` is invalid. The weekmask must be a 7-character string of '0's and '1's (e.g., "1111100" for Mon-Fri) or space-separated day names (e.g., "Mon Tue Wed Thu Fri").`,
        sourceCode,
        'Use a valid weekmask string like "1111100" (Mon-Fri) or "Mon Tue Wed Thu Fri".',
      )
    }

    return null
  },
}
