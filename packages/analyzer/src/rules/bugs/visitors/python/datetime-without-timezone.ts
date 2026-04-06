import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// datetime constructor calls that should include timezone info
const DATETIME_CONSTRUCTORS = new Set([
  'datetime.datetime', 'datetime', 'datetime.now', 'datetime.datetime.now',
])

const TIMEZONE_KWARG_NAMES = new Set(['tzinfo', 'tz', 'timezone'])

export const pythonDatetimeWithoutTimezoneVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/datetime-without-timezone',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcText = func.text

    // Match datetime.datetime(...), datetime(...), datetime.now(), datetime.datetime.now()
    if (!DATETIME_CONSTRUCTORS.has(funcText) && funcText !== 'datetime.now') return null

    // For `datetime.now()` and `datetime.datetime.now()`, the tz kwarg is `tz`
    const args = node.childForFieldName('arguments')
    if (!args) return null

    const hasTimezone = args.namedChildren.some((arg) => {
      if (arg.type === 'keyword_argument') {
        const key = arg.childForFieldName('name')
        return key && TIMEZONE_KWARG_NAMES.has(key.text)
      }
      return false
    })

    // For datetime(...) constructor, if there are positional args (year, month, day, ...)
    // the tz is the last positional arg (index 7)
    const positionalArgs = args.namedChildren.filter((a) => a.type !== 'keyword_argument')

    // Skip if called with no args (e.g., datetime.now() — will have tz check below)
    if (funcText.endsWith('.now')) {
      // datetime.now(tz=None) — flag if no tz arg
      if (!hasTimezone) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'datetime.now() without timezone',
          '`datetime.now()` called without timezone info — creates a naive datetime that is ambiguous across timezones.',
          sourceCode,
          'Use `datetime.now(tz=datetime.timezone.utc)` or `datetime.now(tz=pytz.utc)` to create a timezone-aware datetime.',
        )
      }
      return null
    }

    // For datetime(...) constructor with positional args
    if (positionalArgs.length >= 3 && !hasTimezone) {
      // datetime(year, month, day) without tzinfo
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Datetime created without timezone',
        '`datetime()` constructed without `tzinfo` — creates a naive datetime that is ambiguous across timezones.',
        sourceCode,
        'Pass `tzinfo=datetime.timezone.utc` (or your timezone) to create a timezone-aware datetime.',
      )
    }

    return null
  },
}
