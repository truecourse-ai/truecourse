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

    if (/(?<!\?[=!<])\(\)/.test(src)) {
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
