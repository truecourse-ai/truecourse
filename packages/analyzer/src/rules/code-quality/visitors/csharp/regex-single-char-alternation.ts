import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

export const csharpRegexSingleCharAlternationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-single-char-alternation',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    if (/\(([^()|]{1}\|){2,}[^()|]{1}\)/.test(usage.pattern)) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Single character alternation in regex',
        'Alternation of single characters like `(a|b|c)` is more efficient as a character class `[abc]`.',
        sourceCode,
        'Replace `(a|b|c)` with `[abc]` for better readability and performance.',
      )
    }
    return null
  },
}
