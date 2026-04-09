import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const MAX_REGEX_LENGTH = 50
const MAX_GROUPS = 5

export const regexComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-complexity',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const patternNode = node.namedChildren.find((c) => c.type === 'regex_pattern')
    if (!patternNode) return null

    const pattern = patternNode.text

    // Skip well-known regex patterns (UUID, email, ISO date, semver)
    const wellKnownPatterns = [
      /\[0-9a-f\]\{8\}-?\[0-9a-f\]\{4\}/i,            // UUID
      /\[a-zA-Z0-9.*\].*@.*\[a-zA-Z0-9\]/,             // Email
      /\\d\{4\}[-/]\\d\{2\}[-/]\\d\{2\}/,              // ISO date
      /\\d+\\.\\d+\\.\\d+/,                              // Semver
    ]
    if (wellKnownPatterns.some((wp) => wp.test(pattern))) return null

    if (pattern.length < MAX_REGEX_LENGTH) {
      // Count groups
      const groupCount = (pattern.match(/\(/g) || []).length
      if (groupCount < MAX_GROUPS) return null
    }

    // Check for excessive nesting or lookaheads
    const hasLookahead = pattern.includes('(?=') || pattern.includes('(?!') || pattern.includes('(?<=') || pattern.includes('(?<!')
    const groupCount = (pattern.match(/\(/g) || []).length
    const isComplex = pattern.length >= MAX_REGEX_LENGTH || groupCount >= MAX_GROUPS || hasLookahead

    if (!isComplex) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Complex regular expression',
      `Regular expression is complex (length: ${pattern.length}, groups: ${groupCount}) — extract to a named constant with a comment explaining it.`,
      sourceCode,
      'Extract the regex to a named constant: `const MY_PATTERN = /regex/;` with a comment explaining its purpose.',
    )
  },
}
