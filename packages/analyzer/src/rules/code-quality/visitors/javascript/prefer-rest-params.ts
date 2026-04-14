import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const preferRestParamsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-rest-params',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['identifier'],
  visit(node, filePath, sourceCode) {
    if (node.text !== 'arguments') return null
    let parent = node.parent
    while (parent) {
      if (parent.type === 'arrow_function') return null
      if (parent.type === 'function_declaration' || parent.type === 'function_expression' || parent.type === 'method_definition') {
        const nodeParent = node.parent
        if (nodeParent?.type === 'member_expression' && nodeParent.childForFieldName('object')?.id === node.id) {
          // arguments.xxx — definitely the arguments object
        } else if (nodeParent?.type === 'call_expression' && nodeParent.childForFieldName('function')?.id === node.id) {
          return null
        }
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Arguments object usage',
          '`arguments` object is error-prone and cannot be used in arrow functions. Use rest parameters `...args` instead.',
          sourceCode,
          'Replace `arguments` with a rest parameter: `function fn(...args) { ... }`.',
        )
      }
      parent = parent.parent
    }
    return null
  },
}
