import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const undefinedAsIdentifierVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/undefined-as-identifier',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['variable_declarator', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    let nameNode = node.childForFieldName('name')

    // For assignment_expression, use 'left'
    if (!nameNode && node.type === 'assignment_expression') {
      nameNode = node.childForFieldName('left')
    }

    if (!nameNode) return null
    if (nameNode.type !== 'identifier') return null
    if (nameNode.text !== 'undefined') return null

    return makeViolation(
      this.ruleKey, nameNode, filePath, 'medium',
      'Using undefined as an identifier',
      '`undefined` used as a variable name — this shadows the global `undefined` value and is extremely confusing.',
      sourceCode,
      'Rename this variable to something meaningful.',
    )
  },
}
