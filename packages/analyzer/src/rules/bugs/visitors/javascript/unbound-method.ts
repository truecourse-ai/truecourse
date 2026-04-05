import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

/**
 * Detects class method references passed without binding.
 * Pattern: `this.method` or `obj.method` used as a value (not called directly)
 * e.g., passed as a callback: `arr.forEach(this.handleItem)` loses `this`.
 */

function isUsedAsValue(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return false

  // Used as an argument: foo(this.method)
  if (parent.type === 'arguments') return true

  // Assigned to a variable or property: const fn = this.method
  if (parent.type === 'variable_declarator') {
    const value = parent.childForFieldName('value')
    return value?.id === node.id
  }

  // Assigned in assignment expression: handler = this.method
  if (parent.type === 'assignment_expression') {
    const right = parent.childForFieldName('right')
    return right?.id === node.id
  }

  // Used in array literal: [this.method]
  if (parent.type === 'array') return true

  // Passed to spread / callback in object property value: { key: this.method }
  if (parent.type === 'pair') {
    const value = parent.childForFieldName('value')
    return value?.id === node.id
  }

  return false
}

export const unboundMethodVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unbound-method',
  languages: JS_LANGUAGES,
  nodeTypes: ['member_expression'],
  visit(node, filePath, sourceCode) {
    const object = node.childForFieldName('object')
    const property = node.childForFieldName('property')

    if (!object || !property) return null

    // Only care about `this.xxx` references
    if (object.text !== 'this') return null

    // Skip if this member_expression is being called: this.method()
    const parent = node.parent
    if (!parent) return null
    if (parent.type === 'call_expression') {
      const fn = parent.childForFieldName('function')
      if (fn?.id === node.id) return null
    }

    // Also skip `this.property = ...` assignments
    if (parent.type === 'assignment_expression') {
      const left = parent.childForFieldName('left')
      if (left?.id === node.id) return null
    }
    if (parent.type === 'member_expression') return null // chained: this.a.b

    if (!isUsedAsValue(node)) return null

    const methodName = property.text

    return makeViolation(
      this.ruleKey,
      node,
      filePath,
      'high',
      'Unbound method reference',
      `\`this.${methodName}\` is used as a value without binding — \`this\` will be lost when called as a callback.`,
      sourceCode,
      'Use `this.method.bind(this)`, an arrow wrapper `() => this.method()`, or declare as an arrow function property.',
    )
  },
}
