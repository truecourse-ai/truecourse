import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const dynamicDeleteVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/dynamic-delete',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children[0]
    if (op?.text !== 'delete') return null

    const operand = node.namedChildren[0]
    if (!operand) return null

    if (operand.type === 'subscript_expression') {
      const index = operand.childForFieldName('index')
      if (!index) return null

      if (index.type === 'string' || index.type === 'number') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Dynamic delete',
        '`delete obj[dynamicKey]` with a computed key is unsafe and can cause unexpected behavior.',
        sourceCode,
        'Avoid using `delete` with dynamic keys. Use a Map or set the property to `undefined` instead.',
      )
    }
    return null
  },
}
