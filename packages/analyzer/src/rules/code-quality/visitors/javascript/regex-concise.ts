import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const regexConciseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-concise',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const patternNode = node.namedChildren.find((c) => c.type === 'regex_pattern')
    if (!patternNode) return null

    const pattern = patternNode.text

    // Check for repeated identical character classes or atoms: [a-z][a-z][a-z] → [a-z]{3}
    const repeatedClassMatch = pattern.match(/(\[[^\]]+\])\1{2,}/)
    if (repeatedClassMatch) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Verbose regex — repeated character class',
        `Repeated character class \`${repeatedClassMatch[1]}\` — use a quantifier like \`${repeatedClassMatch[1]}{N}\`.`,
        sourceCode,
        `Replace repeated \`${repeatedClassMatch[1]}\` with \`${repeatedClassMatch[1]}{count}\`.`,
      )
    }

    // Check for repeated identical atoms: \d\d\d → \d{3}
    const repeatedAtomMatch = pattern.match(/(\\[dDwWsS])\1{2,}/)
    if (repeatedAtomMatch) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Verbose regex — repeated atom',
        `Repeated atom \`${repeatedAtomMatch[1]}\` — use a quantifier like \`${repeatedAtomMatch[1]}{N}\`.`,
        sourceCode,
        `Replace \`${repeatedAtomMatch[1].repeat(3)}...\` with \`${repeatedAtomMatch[1]}{count}\`.`,
      )
    }

    // Check for (.){N} or [.]{N} where N > 1 — could use simpler patterns
    // Check for [0-9] when \d would work, or [a-zA-Z0-9_] when \w would work
    if (pattern.includes('[0-9]') && !pattern.includes('[^0-9]')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Verbose regex — use \\d',
        '`[0-9]` can be written more concisely as `\\d`.',
        sourceCode,
        'Replace `[0-9]` with `\\d` in the regex pattern.',
      )
    }

    return null
  },
}
