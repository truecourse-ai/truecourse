import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const preferConstVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-const',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['lexical_declaration'],
  visit(node, filePath, sourceCode) {
    if (!node.text.startsWith('let ')) return null

    const declarators = node.namedChildren.filter((c) => c.type === 'variable_declarator')
    if (declarators.length === 0) return null

    // Collect each individual binding name from a (possibly nested)
    // destructuring pattern. `let { width: w, height: h }` → ['w', 'h'];
    // `let [a, b] = …` → ['a', 'b']; `let x` → ['x'].
    function collectBindingNames(n: SyntaxNode, out: Set<string>): void {
      if (n.type === 'identifier') {
        out.add(n.text)
        return
      }
      if (n.type === 'shorthand_property_identifier_pattern') {
        out.add(n.text)
        return
      }
      if (n.type === 'array_pattern' || n.type === 'object_pattern') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) collectBindingNames(child, out)
        }
        return
      }
      if (n.type === 'pair_pattern') {
        const value = n.childForFieldName('value')
        if (value) collectBindingNames(value, out)
        return
      }
      if (n.type === 'rest_pattern' || n.type === 'assignment_pattern') {
        const inner = n.childForFieldName('left') ?? n.namedChildren[0]
        if (inner) collectBindingNames(inner, out)
        return
      }
    }

    for (const declarator of declarators) {
      const nameNode = declarator.childForFieldName('name')
      if (!nameNode) continue

      const bindingNames = new Set<string>()
      collectBindingNames(nameNode, bindingNames)
      if (bindingNames.size === 0) continue

      let scope = node.parent
      if (!scope) continue

      // For each binding, check if any reassignment touches it. Any
      // single binding being reassigned saves the WHOLE declarator
      // (you can't make `let` a `const` if any of its bindings is
      // reassigned later).
      let anyReassigned = false

      function leftBindsAny(n: SyntaxNode): boolean {
        if (n.type === 'identifier' && bindingNames.has(n.text)) return true
        if (n.type === 'array_pattern' || n.type === 'object_pattern') {
          for (let i = 0; i < n.namedChildCount; i++) {
            const child = n.namedChild(i)
            if (!child) continue
            if (leftBindsAny(child)) return true
          }
        }
        if (n.type === 'pair_pattern') {
          const value = n.childForFieldName('value')
          if (value && leftBindsAny(value)) return true
        }
        if (n.type === 'rest_pattern' || n.type === 'assignment_pattern') {
          const inner = n.childForFieldName('left') ?? n.namedChildren[0]
          if (inner && leftBindsAny(inner)) return true
        }
        if (n.type === 'shorthand_property_identifier_pattern' && bindingNames.has(n.text)) return true
        return false
      }

      function checkReassignment(n: SyntaxNode): void {
        if (anyReassigned) return
        if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
          const left = n.childForFieldName('left')
          if (left && leftBindsAny(left)) {
            anyReassigned = true
            return
          }
        }
        if (n.type === 'update_expression') {
          for (const name of bindingNames) {
            if (n.text.includes(name)) { anyReassigned = true; return }
          }
        }
        if (n.type === 'for_in_statement' && n.id !== node.parent?.id) {
          const left = n.childForFieldName('left')
          if (left && leftBindsAny(left)) {
            anyReassigned = true
            return
          }
        }
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child) checkReassignment(child)
        }
      }

      checkReassignment(scope)

      if (!anyReassigned) {
        const display = nameNode.text.length > 40 ? nameNode.text.slice(0, 40) + '…' : nameNode.text
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Prefer const',
          `\`let ${display}\` is never reassigned. Use \`const\` instead for immutability.`,
          sourceCode,
          'Replace `let` with `const`.',
        )
      }
    }
    return null
  },
}
