import type { Node as SyntaxNode } from 'web-tree-sitter'
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

    // Only a reference to an actual method loses its `this` when detached, so
    // require positive evidence: `methodName` must resolve to a `method_definition`
    // in an enclosing class body. Without a class context (plain functions,
    // prototype-style objects) `this.<name>` is far more likely a data-property
    // read — e.g. `widget(this.checked)`, `closest(this.element)` — than a
    // method reference, and flagging those is the dominant false positive.
    let classBody: SyntaxNode | null = node.parent
    while (classBody && classBody.type !== 'class_body') classBody = classBody.parent
    if (!classBody) return null

    let resolvesToMethod = false
    for (const member of classBody.namedChildren) {
      if (member.type === 'method_definition') {
        const nameNode = member.childForFieldName('name')
        if (nameNode?.text !== methodName) continue
        // A getter/setter is accessed as a value, not invoked as a callback —
        // reading `this.x` runs the accessor, it does not detach a method.
        const isAccessor = member.children.some(
          (c) => (c.text === 'get' || c.text === 'set') && c.type !== 'property_identifier',
        )
        resolvesToMethod = !isAccessor
        break
      }
      if (member.type === 'public_field_definition' || member.type === 'field_definition') {
        // A same-named field is data (or a bound arrow/function field) — never an
        // unbound-method risk. Private fields use `#name`, which parses as
        // `private_property_identifier`; include both.
        const nameNode = member.children.find(
          (c) => c.type === 'property_identifier' || c.type === 'private_property_identifier',
        )
        if (nameNode?.text === methodName) return null
      }
    }
    if (!resolvesToMethod) return null

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
