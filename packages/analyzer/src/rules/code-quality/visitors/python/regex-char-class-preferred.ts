import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects regex patterns with reluctant quantifiers like `.+?` or `.*?`
 * where a character class would be more explicit and efficient.
 * Example: `".+?"` should be `"[^"]*"`.
 */
export const pythonRegexCharClassPreferredVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-char-class-preferred',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    // Only check strings passed to re.* functions
    const parent = node.parent
    if (!parent || parent.type !== 'argument_list') return null

    const grandParent = parent.parent
    if (!grandParent || grandParent.type !== 'call') return null

    const fn = grandParent.childForFieldName('function')
    if (!fn) return null

    // Check if it's a re.* call
    const fnText = fn.text
    const isReCall = fnText.startsWith('re.') || fnText === 'compile' || fnText === 'search' || fnText === 'match' || fnText === 'findall'
    if (!isReCall) return null

    const pattern = node.text.slice(1, -1) // strip quotes

    // Look for .+? or .*? patterns preceded by a literal character
    // e.g., "something.+?something" suggests using character class
    if (/\..+?\?/.test(pattern) || /\.\*\?/.test(pattern)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Reluctant quantifier where character class preferred',
        'Using `.+?` or `.*?` — a character class like `[^x]*` is more explicit and efficient than a reluctant quantifier.',
        sourceCode,
        'Replace the reluctant quantifier with an explicit character class.',
      )
    }

    return null
  },
}
