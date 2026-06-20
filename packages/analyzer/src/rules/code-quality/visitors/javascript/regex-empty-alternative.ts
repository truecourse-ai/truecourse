import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

// Replace anything that can hold a `|` without it being an alternation
// operator with a neutral placeholder, so the structural checks below only
// see *real* alternation pipes and group parentheses. This neutralizes:
//   - escaped characters (`\|`, `\(`, `\)`, …) → a literal, not an operator
//   - character-class contents (`[a|b]`, `[)]`) → pipes/parens inside `[…]`
//     are literals
function stripRegexLiterals(src: string): string {
  let out = ''
  let inClass = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (ch === '\\' && i + 1 < src.length) {
      // Escaped char — drop the escape and its target as a neutral literal.
      if (!inClass) out += 'x'
      i++
      continue
    }
    if (inClass) {
      if (ch === ']') {
        inClass = false
        out += 'c'
      }
      continue
    }
    if (ch === '[') {
      inClass = true
      continue
    }
    out += ch
  }
  return out
}

export const regexEmptyAlternativeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-alternative',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const rawSrc = getRegexSource(node)
    if (!rawSrc) return null
    const src = stripRegexLiterals(rawSrc)

    if (/\|\|/.test(src) || /^\|/.test(src) || /\|$/.test(src) || /\(\|/.test(src) || /\|\)/.test(src)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty regex alternative',
        'Regular expression contains an empty alternative `|` which matches an empty string — likely a mistake.',
        sourceCode,
        'Remove the empty alternative or add a pattern.',
      )
    }
    return null
  },
}
