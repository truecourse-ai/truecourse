import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects unnecessary non-capturing groups (?:...) that have no quantifier
 * and contain no alternation — the grouping serves no purpose.
 */
export const pythonRegexUnnecessaryNonCapturingGroupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-unnecessary-non-capturing-group',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'argument_list') return null

    const grandParent = parent.parent
    if (!grandParent || grandParent.type !== 'call') return null

    const fn = grandParent.childForFieldName('function')
    if (!fn) return null

    const fnText = fn.text
    const isReCall = fnText.startsWith('re.') || fnText === 'compile'
    if (!isReCall) return null

    const rawPattern = node.text.slice(1, -1).replace(/^r/, '')
    // Look for (?:...) not followed by a quantifier and not containing |
    // Simple heuristic: (?:...) not followed by *, +, ?, {, and no | inside
    const match = rawPattern.match(/\(\?:([^)]*)\)(?![*+?{])/)
    if (!match) return null

    const inner = match[1]
    if (inner.includes('|')) return null // alternation — grouping is needed

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary non-capturing group',
      `Non-capturing group \`(?:${inner})\` has no quantifier or alternation — the grouping serves no purpose and can be removed.`,
      sourceCode,
      `Replace \`(?:${inner})\` with just \`${inner}\`.`,
    )
  },
}
