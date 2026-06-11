import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

export const csharpRegexSuperfluousQuantifierVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-superfluous-quantifier',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    // `{1,2}` / `{1,}` are real ranges and never match the literal `{1}`.
    if (!usage.pattern.includes('{1}')) return null

    return makeViolation(
      this.ruleKey, usage.patternNode, filePath, 'low',
      'Superfluous {1} regex quantifier',
      'Regex contains a `{1}` quantifier which has no effect — it can be removed.',
      sourceCode,
      'Remove the `{1}` quantifier from the regex.',
    )
  },
}
