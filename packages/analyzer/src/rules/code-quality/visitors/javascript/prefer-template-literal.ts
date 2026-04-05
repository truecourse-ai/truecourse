import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const preferTemplateLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-template-literal',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.children.find((c) => c.type === '+')
    if (!operator) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const leftIsString = left.type === 'string'
    const rightIsString = right.type === 'string'

    if (!leftIsString && !rightIsString) return null
    if (leftIsString && rightIsString) return null

    const parent = node.parent
    if (parent?.type === 'binary_expression') {
      const parentOp = parent.children.find((c) => c.type === '+')
      if (parentOp) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'String concatenation',
      'String concatenation with `+` can be replaced with a template literal for better readability.',
      sourceCode,
      'Replace string concatenation with a template literal: `text ${expr}`.',
    )
  },
}
