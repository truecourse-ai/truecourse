import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

export const csharpRegexEmptyAfterReluctantVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-empty-after-reluctant',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    if (/[*+]\?[^|()[\]]*\?/.test(usage.pattern)) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Empty match after reluctant quantifier',
        'Reluctant (lazy) quantifier followed by a pattern that can match empty — the reluctant part will always match 0 times.',
        sourceCode,
        'Review the regex: the reluctant quantifier may never match anything useful.',
      )
    }
    return null
  },
}
