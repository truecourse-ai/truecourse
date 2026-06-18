import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

export const csharpRegexSingleCharClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-single-char-class',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    if (/\[([^\\\]^-])\]/.test(usage.pattern)) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Single character in character class',
        'Character class with a single character `[x]` should just be `x` directly.',
        sourceCode,
        'Replace `[x]` with `x` in the regular expression.',
      )
    }
    return null
  },
}
