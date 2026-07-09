import type { Node as SyntaxNode, Tree } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// The set of identifiers declared as an ES6 `class` in a file, keyed on `Tree`
// (stable across re-walks — see the note in _shared/python-framework-detection).
// Computed once per file the first time the rule fires on it.
const declaredClassesCache = new WeakMap<Tree, Set<string>>()

function getDeclaredClasses(node: SyntaxNode): Set<string> {
  const tree = node.tree
  const cached = declaredClassesCache.get(tree)
  if (cached) return cached

  // Class names are `identifier` in JS but `type_identifier` in TS.
  const isNameNode = (n: SyntaxNode | null): n is SyntaxNode =>
    n?.type === 'identifier' || n?.type === 'type_identifier'

  const names = new Set<string>()
  function walk(n: SyntaxNode) {
    // `class Foo {}` / `export class Foo {}`
    if (n.type === 'class_declaration') {
      const name = n.childForFieldName('name')
      if (isNameNode(name)) names.add(name.text)
    }
    // Class expression `const Foo = class {}` / `Foo = class {}`. The `class`
    // keyword token also has node type `class`; a real class expression has a
    // body, the bare keyword does not — use that to tell them apart.
    if (n.type === 'class' && n.childForFieldName('body')) {
      const name = n.childForFieldName('name')
      if (isNameNode(name)) names.add(name.text)
      else {
        const parent = n.parent
        if (parent?.type === 'variable_declarator') {
          const boundName = parent.childForFieldName('name')
          if (isNameNode(boundName)) names.add(boundName.text)
        } else if (parent?.type === 'assignment_expression') {
          const left = parent.childForFieldName('left')
          if (isNameNode(left)) names.add(left.text)
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(tree.rootNode)

  declaredClassesCache.set(tree, names)
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
    if (right?.type !== 'function_expression' && right?.type !== 'arrow_function') return null

    // The rule targets the *inconsistent* pattern of declaring an ES6 `class`
    // and then assigning methods onto its `.prototype` externally. Assigning to
    // the prototype of a plain ES5 constructor function is the correct, idiomatic
    // pattern — there is no class body to be inconsistent with. Only fire when the
    // receiver is actually declared as a class in this file.
    const receiver = obj.childForFieldName('object')
    if (receiver?.type !== 'identifier') return null
    if (!getDeclaredClasses(node).has(receiver.text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prototype assignment in class context',
      `Assigning methods via \`${obj.text}\` is inconsistent with ES6 class syntax. Use class method definitions instead.`,
      sourceCode,
      'Move the method into a class body definition.',
    )
  },
}
