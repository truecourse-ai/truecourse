import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexSingleCharClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-single-char-class',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    if (/\[([^\\\]^-])\]/.test(src)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Single character in character class',
        'Character class with a single character `[x]` should just be `x` directly.',
        sourceCode,
        'Replace `[x]` with `x` in the regular expression.',
      )
    }
    return null
  },
}
