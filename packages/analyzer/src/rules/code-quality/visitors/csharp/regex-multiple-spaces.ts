import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, csharpRegexIgnoresWhitespace, getCSharpRegexUsage } from './_regex-helpers.js'

export const csharpRegexMultipleSpacesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-multiple-spaces',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    // With IgnorePatternWhitespace / (?x), literal spaces are stripped from
    // the pattern entirely — consecutive spaces are formatting, not atoms.
    if (csharpRegexIgnoresWhitespace(usage)) return null

    const stripped = usage.pattern.replace(/\[[^\]]*\]/g, '')
    if (/ {2}/.test(stripped)) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Multiple spaces in regex',
        'Multiple consecutive spaces in a regex are hard to count. Use a quantifier like ` {3}` instead.',
        sourceCode,
        'Replace multiple spaces with a quantifier: ` {N}`.',
      )
    }
    return null
  },
}
