import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexEmptyAlternativeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-alternative',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

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
