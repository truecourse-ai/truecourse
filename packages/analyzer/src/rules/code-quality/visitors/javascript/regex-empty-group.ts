import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexEmptyGroupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-group',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    if (hasEmptyGroup(src)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty regex group',
        'Regular expression contains an empty group `()` which matches an empty string — likely a mistake.',
        sourceCode,
        'Remove the empty group or add a pattern inside it.',
      )
    }
    return null
  },
}

// Scan regex source for empty `()` groups outside of character classes.
// Skips escapes (\(, \[, \\), character classes ([...]), and lookarounds/non-capturing groups.
function hasEmptyGroup(src: string): boolean {
  let i = 0
  let inClass = false
  while (i < src.length) {
    const ch = src[i]
    if (ch === '\\') {
      i += 2
      continue
    }
    if (inClass) {
      if (ch === ']') inClass = false
      i++
      continue
    }
    if (ch === '[') {
      inClass = true
      i++
      continue
    }
    if (ch === '(') {
      // Check group opener: only flag plain `()` — not `(?:)`, `(?=)`, `(?!)`, `(?<=)`, `(?<!)`, `(?<name>)`.
      if (src[i + 1] === ')') return true
      i++
      continue
    }
    i++
  }
  return false
}
