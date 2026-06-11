import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csharpTrivialTernaryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/trivial-ternary',
  languages: ['csharp'],
  nodeTypes: ['conditional_expression'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')
    if (!consequence || !alternative) return null

    if (consequence.text === 'true' && alternative.text === 'false') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Trivial ternary (x ? true : false)',
        'This conditional is redundant — it always evaluates to the condition itself. Use the condition directly.',
        sourceCode,
        'Remove the ternary and use the condition directly.',
      )
    }

    if (consequence.text === 'false' && alternative.text === 'true') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Trivial ternary (x ? false : true)',
        'This conditional is redundant — it always evaluates to the negation of the condition. Replace with `!condition`.',
        sourceCode,
        'Replace with `!condition`.',
      )
    }

    return null
  },
}
