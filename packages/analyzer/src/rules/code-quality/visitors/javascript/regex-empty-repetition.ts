import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexEmptyRepetitionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-repetition',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    if (/\([^)]*[*+][^)]*\)[*+]/.test(src)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty string repetition in regex',
        'Repeated group can match an empty string, which may cause catastrophic backtracking.',
        sourceCode,
        'Restructure the regex to avoid nested quantifiers on patterns that can match empty strings.',
      )
    }
    return null
  },
}
