import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const preferConstVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-const',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['lexical_declaration'],
  visit(node, filePath, sourceCode) {
    if (!node.text.startsWith('let ')) return null

    // Loop-header `let` (e.g. `for (let i = 0, max = len - 1; ...)`) —
    // even when individual declarators (`max`) aren't reassigned, the
    // single-declaration convention for loop locals is idiomatic.
    if (node.parent?.type === 'for_statement') return null

    const declarators = node.namedChildren.filter((c) => c.type === 'variable_declarator')
    if (declarators.length === 0) return null

    for (const declarator of declarators) {
      const nameNode = declarator.childForFieldName('name')
      if (!nameNode) continue

      // Destructured `let` (e.g. `let { width, height } = …`,
      // `let [a, b] = …`) — the visitor's name-based reassignment
      // check can't reliably tell whether an individual binding is
      // reassigned later, and rewriting a destructured `let` to
      // `const` is broken if any single binding is reassigned.
      if (nameNode.type === 'object_pattern' || nameNode.type === 'array_pattern') return null

      const varName = nameNode.text

      let scope = node.parent
      if (!scope) continue

      let isReassigned = false

      function patternContainsName(n: SyntaxNode, name: string): boolean {
        if ((n.type === 'identifier' || n.type === 'shorthand_property_identifier_pattern')
          && n.text === name) return true
        for (let i = 0; i < n.childCount; i++) {
          const c = n.child(i)
          if (c && patternContainsName(c, name)) return true
        }
        return false
      }

      function checkReassignment(n: SyntaxNode) {
        if (isReassigned) return
        if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
          const left = n.childForFieldName('left')
          if (left?.text === varName) {
            isReassigned = true
            return
          }
          // Destructured assignment (`[a, b] = …` or `({ a, b } = …)`)
          // reassigns each binding inside the pattern.
          if (left && (left.type === 'array_pattern' || left.type === 'object_pattern')
            && patternContainsName(left, varName)) {
            isReassigned = true
            return
          }
        }
        if (n.type === 'update_expression') {
          if (n.text.includes(varName)) {
            isReassigned = true
            return
          }
        }
        if ((n.type === 'for_in_statement') && n.id !== node.parent?.id) {
          const left = n.childForFieldName('left')
          if (left?.text?.includes(varName)) {
            isReassigned = true
            return
          }
        }
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child) checkReassignment(child)
        }
      }

      checkReassignment(scope)

      if (!isReassigned) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Prefer const',
          `\`let ${varName}\` is never reassigned. Use \`const\` instead for immutability.`,
          sourceCode,
          'Replace `let` with `const`.',
        )
      }
    }
    return null
  },
}
