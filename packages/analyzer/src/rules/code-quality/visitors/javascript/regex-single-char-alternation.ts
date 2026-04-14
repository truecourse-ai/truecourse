import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexSingleCharAlternationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-single-char-alternation',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    if (/\(([^()|]{1}\|){2,}[^()|]{1}\)/.test(src)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Single character alternation in regex',
        'Alternation of single characters like `(a|b|c)` is more efficient as a character class `[abc]`.',
        sourceCode,
        'Replace `(a|b|c)` with `[abc]` for better readability and performance.',
      )
    }
    return null
  },
}
