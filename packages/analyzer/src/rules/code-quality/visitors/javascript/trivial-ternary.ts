import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const trivialTernaryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/trivial-ternary',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['ternary_expression'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')
    if (!consequence || !alternative) return null

    if (consequence.text === 'true' && alternative.text === 'false') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Trivial ternary (x ? true : false)',
        'This ternary is redundant — it always returns the condition itself. Replace with the condition directly.',
        sourceCode,
        'Remove the ternary and use the condition directly.',
      )
    }

    if (consequence.text === 'false' && alternative.text === 'true') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Trivial ternary (x ? false : true)',
        'This ternary is redundant — it always returns the negation of the condition. Replace with `!condition`.',
        sourceCode,
        'Replace with `!condition`.',
      )
    }

    return null
  },
}
