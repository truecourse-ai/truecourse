import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects regex quantifiers like {1} that have no effect.
 */
export const pythonRegexSuperfluousQuantifierVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-superfluous-quantifier',
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

    const pattern = node.text

    // Look for {1} quantifier
    if (!pattern.includes('{1}')) return null

    // But not {1,2} or {1,} etc
    if (/\{1,[^}]/.test(pattern)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Superfluous {1} regex quantifier',
      'Regex contains `{1}` quantifier which has no effect — it can be removed.',
      sourceCode,
      'Remove the `{1}` quantifier from the regex.',
    )
  },
}
