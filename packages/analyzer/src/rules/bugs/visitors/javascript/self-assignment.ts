import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const selfAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-assignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.children.find((c) => c.text === '=')

    if (!left || !right || !operator) return null
    // Only plain assignment, not +=, -=, etc.
    if (operator.text !== '=') return null

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
