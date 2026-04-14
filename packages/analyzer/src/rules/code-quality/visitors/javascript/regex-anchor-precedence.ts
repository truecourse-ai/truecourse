import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getRegexSource } from './_helpers.js'

export const regexAnchorPrecedenceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-anchor-precedence',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex', 'new_expression'],
  visit(node, filePath, sourceCode) {
    const src = getRegexSource(node)
    if (!src) return null

    if (/\|/.test(src)) {
      const hasStartAnchorWithoutGroup = /^\^[^(]/.test(src) && /\|/.test(src)
      const hasEndAnchorWithoutGroup = /[^)]\$$/.test(src) && /\|/.test(src)
      const topLevelHasAlternation = (() => {
        let depth = 0
        for (const ch of src) {
          if (ch === '(') depth++
          else if (ch === ')') depth--
          else if (ch === '|' && depth === 0) return true
        }
        return false
      })()

      if (topLevelHasAlternation && (hasStartAnchorWithoutGroup || hasEndAnchorWithoutGroup)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Regex anchor precedence issue',
          '`^` or `$` anchor in regex alternation only anchors one alternative. Wrap in a group: `^(foo|bar)$`.',
          sourceCode,
          'Wrap the alternation in a group: `^(a|b)$` instead of `^a|b$`.',
        )
      }
    }
    return null
  },
}
