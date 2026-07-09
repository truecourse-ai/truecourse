import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Collect the names bound to an ES6 `class` in this file — both
// `class Foo {}` declarations and `const Foo = class {}` expressions. The rule
// only makes sense when the `.prototype` receiver is actually one of these:
// grafting a method onto a real class's prototype is inconsistent with class
// syntax, whereas the same shape on an ES5 constructor function is idiomatic.
function collectClassNames(root: import('web-tree-sitter').Node): Set<string> {
  const names = new Set<string>()
  const stack: (import('web-tree-sitter').Node)[] = [root]
  while (stack.length > 0) {
    const n = stack.pop()!
    if (n.type === 'class_declaration') {
      const name = n.childForFieldName('name')
      if (name?.text) names.add(name.text)
    } else if (n.type === 'variable_declarator') {
      const name = n.childForFieldName('name')
      const value = n.childForFieldName('value')
      if (name?.type === 'identifier' && value &&
          (value.type === 'class' || value.type === 'class_expression')) {
        names.add(name.text)
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return names
}

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
      const receiver = obj.childForFieldName('object')

      // A simple identifier receiver is required to reason about whether it is
      // a class. `X.prototype.m = fn` where `X` is anything else (a member
      // expression, a call, etc.) is not the ES6-class inconsistency this rule
      // targets.
      if (receiver?.type !== 'identifier') return null

      const BUILTINS = new Set(['Array', 'Object', 'String', 'Number', 'Boolean', 'Function',
        'RegExp', 'Date', 'Error', 'Map', 'Set', 'Promise', 'Symbol'])
      if (BUILTINS.has(receiver.text)) return null

      // Only fire when the receiver is actually declared as an ES6 class in the
      // same file. Assigning `.prototype` methods on a plain ES5 constructor
      // function is idiomatic ES5, not an inconsistency with class syntax.
      let root = node
      while (root.parent) root = root.parent
      const classNames = collectClassNames(root)
      if (!classNames.has(receiver.text)) return null

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
