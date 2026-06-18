import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

export const csharpRegexEmptyRepetitionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-repetition',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    // .NET's default engine backtracks like JS's, so a repeated group that
    // can match the empty string (empty group, or trailing `*`/`?`/`{0,…}`
    // atom) risks catastrophic backtracking. RegexOptions.NonBacktracking
    // sidesteps the blowup.
    if (usage.optionsText.includes('NonBacktracking')) return null
    if (/\((?:\?[:!=]|\?<[!=])?(?:[^)]*(?:[*?]|\{0,\d*\}))?\)[*+]/.test(usage.pattern)) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Empty string repetition in regex',
        'Repeated group can match an empty string, which may cause catastrophic backtracking.',
        sourceCode,
        'Restructure the regex to avoid nested quantifiers on patterns that can match empty strings.',
      )
    }
    return null
  },
}
