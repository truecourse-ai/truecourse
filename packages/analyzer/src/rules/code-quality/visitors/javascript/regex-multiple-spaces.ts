import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexMultipleSpacesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-multiple-spaces',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    const stripped = src.replace(/\[[^\]]*\]/g, '')
    if (/  /.test(stripped)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Multiple spaces in regex',
        'Multiple consecutive spaces in a regex are hard to count. Use a quantifier like `/ {3}/` instead.',
        sourceCode,
        'Replace multiple spaces with a quantifier: `/ {N}/`.',
      )
    }
    return null
  },
}
