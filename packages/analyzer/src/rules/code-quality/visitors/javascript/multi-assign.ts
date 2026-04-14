import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const multiAssignVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/multi-assign',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (right?.type === 'assignment_expression') {
      const parent = node.parent
      if (parent?.type === 'assignment_expression') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Chained assignment',
        'Chained assignments like `a = b = c` are hard to read. Use separate assignment statements.',
        sourceCode,
        'Split into separate assignment statements.',
      )
    }
    return null
  },
}
