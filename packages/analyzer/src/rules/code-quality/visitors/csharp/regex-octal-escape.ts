import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

/**
 * Only the unambiguous `\0nn` octal form is flagged. Bare `\1`–`\9` are NOT:
 * unlike Python's string layer, in a .NET regex they are well-defined
 * backreferences (or octal only when no such group exists — which other
 * rules surface as a broken pattern).
 */
export const csharpRegexOctalEscapeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-octal-escape',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null

    if (/\\0[0-7]{1,2}/.test(usage.pattern)) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Octal escape sequence in regex',
        'Regex contains an octal escape sequence — use explicit hex (`\\xNN`) or Unicode (`\\uNNNN`) escapes instead.',
        sourceCode,
        'Replace octal escapes with explicit hex or Unicode escapes.',
      )
    }
    return null
  },
}
