import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_REGEX_NODE_TYPES, getCSharpRegexUsage } from './_regex-helpers.js'

/**
 * Repeated-atom shapes only. The JS rule's `[0-9]` → `\d` suggestion is
 * deliberately NOT ported: in .NET, `\d` matches all Unicode decimal digits
 * (unless RegexOptions.ECMAScript), so the rewrite changes semantics.
 */
export const csharpRegexConciseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-concise',
  languages: ['csharp'],
  nodeTypes: CSHARP_REGEX_NODE_TYPES,
  visit(node, filePath, sourceCode) {
    const usage = getCSharpRegexUsage(node)
    if (!usage) return null
    const pattern = usage.pattern

    // [a-z][a-z][a-z] → [a-z]{3}
    const repeatedClassMatch = pattern.match(/(\[[^\]]+\])\1{2,}/)
    if (repeatedClassMatch) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Verbose regex — repeated character class',
        `Repeated character class \`${repeatedClassMatch[1]}\` — use a quantifier like \`${repeatedClassMatch[1]}{N}\`.`,
        sourceCode,
        `Replace repeated \`${repeatedClassMatch[1]}\` with \`${repeatedClassMatch[1]}{count}\`.`,
      )
    }

    // \d\d\d → \d{3}
    const repeatedAtomMatch = pattern.match(/(\\[dDwWsS])\1{2,}/)
    if (repeatedAtomMatch) {
      return makeViolation(
        this.ruleKey, usage.patternNode, filePath, 'low',
        'Verbose regex — repeated atom',
        `Repeated atom \`${repeatedAtomMatch[1]}\` — use a quantifier like \`${repeatedAtomMatch[1]}{N}\`.`,
        sourceCode,
        `Replace \`${repeatedAtomMatch[1]!.repeat(3)}...\` with \`${repeatedAtomMatch[1]}{count}\`.`,
      )
    }

    return null
  },
}
