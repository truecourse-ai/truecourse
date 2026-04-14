import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSelfAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-assignment',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')

    if (!left || !right) return null

    if (left.text === right.text && left.type === right.type) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Self assignment',
        `Assigning \`${left.text}\` to itself has no effect.`,
        sourceCode,
        'Assign a different value or remove this statement.',
      )
    }
    return null
  },
}
