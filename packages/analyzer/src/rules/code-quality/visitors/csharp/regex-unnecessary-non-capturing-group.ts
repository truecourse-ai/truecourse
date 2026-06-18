import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

export const csharpRegexUnnecessaryNonCapturingGroupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-unnecessary-non-capturing-group',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    // (?:...) with no quantifier behind it and no alternation inside —
    // the grouping serves no purpose.
    const match = usage.pattern.match(/\(\?:([^)]*)\)(?![*+?{])/)
    if (!match) return null

    const inner = match[1]!
    if (inner.includes('|')) return null

    return makeViolation(
      this.ruleKey, usage.patternNode, filePath, 'low',
      'Unnecessary non-capturing group',
      `Non-capturing group \`(?:${inner})\` has no quantifier or alternation — the grouping serves no purpose and can be removed.`,
      sourceCode,
      `Replace \`(?:${inner})\` with just \`${inner}\`.`,
    )
  },
}
