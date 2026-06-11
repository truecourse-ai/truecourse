import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csharpMultiAssignVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/multi-assign',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (right?.type !== 'assignment_expression') return null
    // Report only the outermost link of the chain.
    if (node.parent?.type === 'assignment_expression') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Chained assignment',
      'Chained assignments like `a = b = c` are hard to read. Use separate assignment statements.',
      sourceCode,
      'Split into separate assignment statements.',
    )
  },
}
