import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects pytest.raises() with a match= pattern that is ambiguous — specifically,
 * a match pattern that does not start with ^ or end with $ (could match unintended parts).
 * RUF043: PytestRaisesAmbiguousPattern.
 *
 * The rule flags match= patterns that are simple literal strings without regex anchors,
 * since they might match an unintended substring of the exception message.
 */
export const pythonPytestRaisesAmbiguousPatternVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/pytest-raises-ambiguous-pattern',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const func = node.childForFieldName('function')
    if (!func) return null

    const funcText = func.text
    if (funcText !== 'pytest.raises' && funcText !== 'raises') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Find match= keyword argument
    const matchArg = args.namedChildren.find((a) => {
      if (a.type === 'keyword_argument') {
        const k = a.childForFieldName('name')
        return k?.text === 'match'
      }
      return false
    })

    if (!matchArg) return null

    const value = matchArg.childForFieldName('value')
    if (!value || value.type !== 'string') return null

    // Extract string value
    const raw = value.text
    // Remove quotes
    const inner = raw.replace(/^r?["']|["']$/g, '').replace(/^r?"""[\s\S]*"""$/, (m) => m.slice(3, -3))

    // If the pattern contains no anchors and no regex special chars that imply specificity,
    // it might match unintended substrings
    const hasAnchor = inner.startsWith('^') || inner.endsWith('$')
    const hasRegexSpecial = /[.*+?{}[\]\\|()]/.test(inner)

    if (!hasAnchor && !hasRegexSpecial && inner.length > 0) {
      return makeViolation(
        this.ruleKey, matchArg, filePath, 'medium',
        'pytest.raises match pattern may be ambiguous',
        `\`pytest.raises(match="${inner}")\` uses a plain string without regex anchors — it matches any exception message containing this substring. Consider anchoring with \`^\` and \`$\` for exact matching.`,
        sourceCode,
        `Use anchored regex: \`match="^${inner}$"\` to match the exact message, or add \`re.escape()\` if matching literal text.`,
      )
    }

    return null
  },
}
