import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noSequencesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-sequences',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['sequence_expression'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (parent?.type === 'for_statement') {
      const initializer = parent.childForFieldName('initializer')
      const increment = parent.childForFieldName('increment')
      if (initializer?.id === node.id || increment?.id === node.id) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Comma operator usage',
      'The comma operator evaluates both expressions but only returns the last value — this is rarely intentional.',
      sourceCode,
      'Use separate statements instead of the comma operator.',
    )
  },
}
