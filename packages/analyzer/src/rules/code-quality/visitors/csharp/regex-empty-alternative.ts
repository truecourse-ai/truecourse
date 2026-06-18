import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

export const csharpRegexEmptyAlternativeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-alternative',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null
    const src = usage.pattern

    if (/\|\|/.test(src) || /^\|/.test(src) || /\|$/.test(src) || /\(\|/.test(src) || /\|\)/.test(src)) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Empty regex alternative',
        'Regular expression contains an empty alternative `|` which matches an empty string — likely a mistake.',
        sourceCode,
        'Remove the empty alternative or add a pattern.',
      )
    }
    return null
  },
}
