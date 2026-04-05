import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const classPrototypeAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/class-prototype-assignment',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'member_expression') return null

    const obj = left.childForFieldName('object')
    const prop = left.childForFieldName('property')
    if (!obj || !prop) return null

    if (obj.type !== 'member_expression') return null
    const prototypeProp = obj.childForFieldName('property')
    if (prototypeProp?.text !== 'prototype') return null

    const right = node.childForFieldName('right')
    if (right?.type === 'function_expression' || right?.type === 'arrow_function') {
      const builtinObj = obj.childForFieldName('object')
      const BUILTINS = new Set(['Array', 'Object', 'String', 'Number', 'Boolean', 'Function',
        'RegExp', 'Date', 'Error', 'Map', 'Set', 'Promise', 'Symbol'])
      if (builtinObj?.type === 'identifier' && BUILTINS.has(builtinObj.text)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Prototype assignment in class context',
        `Assigning methods via \`${obj.text}\` is inconsistent with ES6 class syntax. Use class method definitions instead.`,
        sourceCode,
        'Move the method into a class body definition.',
      )
    }
    return null
  },
}
