import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const extendNativeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/extend-native',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'member_expression') return null

    const obj = left.childForFieldName('object')
    const prop = left.childForFieldName('property')
    if (!obj || !prop) return null

    if (obj.type !== 'member_expression') return null
    const builtinName = obj.childForFieldName('object')
    const prototypeProp = obj.childForFieldName('property')

    if (prototypeProp?.text !== 'prototype') return null

    const BUILTINS = new Set(['Array', 'Object', 'String', 'Number', 'Boolean', 'Function',
      'RegExp', 'Date', 'Error', 'Map', 'Set', 'Promise', 'Symbol', 'Math', 'JSON'])

    if (builtinName?.type === 'identifier' && BUILTINS.has(builtinName.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Extending native type',
        `Modifying \`${builtinName.text}.prototype\` is dangerous — it can conflict with libraries and future language features.`,
        sourceCode,
        'Use a utility function or subclass instead of modifying the native prototype.',
      )
    }
    return null
  },
}
