import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexEmptyAfterReluctantVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-after-reluctant',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    if (/[*+]\?[^|()[\]]*\?/.test(src)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty match after reluctant quantifier',
        'Reluctant quantifier followed by a pattern that can match empty — the reluctant part will always match 0 times.',
        sourceCode,
        'Review the regex: the reluctant quantifier may never match anything useful.',
      )
    }
    return null
  },
}
