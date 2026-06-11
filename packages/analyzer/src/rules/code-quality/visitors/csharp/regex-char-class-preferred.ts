import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, csharpRegexIsSingleline, getCSharpRegexUsage } from './_regex-helpers.js'

export const csharpRegexCharClassPreferredVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-char-class-preferred',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    // In Singleline mode `.` crosses newlines — `.*?` is then the canonical
    // way to lazily span lines and a `[^x]*` rewrite would be wrong.
    if (csharpRegexIsSingleline(usage)) return null

    if (/\.[*+]\?/.test(usage.pattern)) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Reluctant quantifier where character class preferred',
        'Using `.+?` or `.*?` — a character class like `[^x]*` is more explicit and avoids backtracking in the .NET engine.',
        sourceCode,
        'Replace the reluctant quantifier with an explicit negated character class.',
      )
    }
    return null
  },
}
