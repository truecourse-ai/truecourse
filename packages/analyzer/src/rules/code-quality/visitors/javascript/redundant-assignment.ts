import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const redundantAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-assignment',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    if (left.type === 'identifier' && right.type === 'identifier' && left.text === right.text) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant self-assignment',
        `\`${left.text} = ${right.text}\` assigns a variable to itself — this has no effect.`,
        sourceCode,
        'Remove the self-assignment.',
      )
    }

    return null
  },
}
