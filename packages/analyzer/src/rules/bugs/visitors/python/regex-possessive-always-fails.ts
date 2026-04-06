import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects regex patterns where a possessive/atomic quantifier is followed
 * by a pattern that requires characters the quantifier already consumed.
 * E.g., r'a++a' or patterns using atomic groups (?>...) followed by
 * overlapping content.
 *
 * Python 3.11+ supports possessive quantifiers (*+, ++, ?+, {n,m}+).
 */
export const pythonRegexPossessiveAlwaysFailsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/regex-possessive-always-fails',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    const fnText = fn.text
    if (!/^re\.(compile|search|match|fullmatch|findall|sub|finditer|split)\b/.test(fnText)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const pattern = extractPattern(firstArg)
    if (!pattern) return null

    // Detect possessive quantifier followed by same character/class
    // Patterns: X++X, X*+X, X?+X, X{n,m}+X where X is the same char/class
    // Possessive quantifiers: *+, ++, ?+, {n,m}+
    const possessivePattern = /([a-zA-Z0-9]|\\[dDwWsS]|\[(?:[^\]\\]|\\.)*\])([+*?]|\{\d+(?:,\d*)?\})\+(\1|[a-zA-Z0-9])/g

    let match
    while ((match = possessivePattern.exec(pattern)) !== null) {
      const [fullMatch, consumed, , following] = match
      // If the possessive quantifier consumes the same char that follows
      if (consumed === following || (consumed.length === 1 && following === consumed)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Pattern after possessive quantifier always fails',
          `Possessive quantifier '${fullMatch}' will consume all '${consumed}' characters, making the following '${following}' unmatchable.`,
          sourceCode,
          'Use a non-possessive quantifier or restructure the pattern.',
        )
      }
    }

    // Also detect atomic group (?>...) followed by overlapping content
    const atomicPattern = /\(\?>([a-zA-Z]+)\+?\)(\1)/g
    while ((match = atomicPattern.exec(pattern)) !== null) {
      const [fullMatch, groupContent, following] = match
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Pattern after atomic group always fails',
        `Atomic group in '${fullMatch}' consumes '${groupContent}' and the following '${following}' can never match.`,
        sourceCode,
        'Restructure the pattern to avoid atomic group conflict.',
      )
    }

    return null
  },
}

function extractPattern(node: { type: string; text: string }): string | null {
  const text = node.text
  const match = text.match(/^[brBR]*['"]{1,3}(.*?)['"]{1,3}$/)
  if (match) return match[1]
  return null
}
