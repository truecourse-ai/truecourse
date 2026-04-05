import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

export const pythonUnusedVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-variable',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    const declared = new Map<string, SyntaxNode>()
    const read = new Set<string>()

    function collectDeclarations(n: SyntaxNode) {
      if (n.type === 'function_definition' && n !== node) return
      if (n.type === 'assignment') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier') {
          declared.set(left.text, left)
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectDeclarations(child)
      }
    }

    function collectReads(n: SyntaxNode) {
      if (n.type === 'function_definition' && n !== node) {
        // Mark all identifiers in nested functions as read
        function markAll(m: SyntaxNode) {
          if (m.type === 'identifier') read.add(m.text)
          for (let i = 0; i < m.childCount; i++) {
            const c = m.child(i)
            if (c) markAll(c)
          }
        }
        markAll(n)
        return
      }
      if (n.type === 'identifier') {
        const parent = n.parent
        if (parent?.type === 'assignment' && parent.childForFieldName('left') === n) {
          // left side of assignment — not a read
        } else {
          read.add(n.text)
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectReads(child)
      }
    }

    collectDeclarations(bodyNode)
    collectReads(bodyNode)

    for (const [name, nameNode] of declared) {
      if (!read.has(name) && !name.startsWith('_')) {
        return makeViolation(
          'code-quality/deterministic/unused-variable', nameNode, filePath, 'medium',
          'Unused variable',
          `Variable \`${name}\` is assigned but never read. Remove it or prefix with _ to mark as intentionally unused.`,
          sourceCode,
          'Remove the unused variable or prefix its name with _ to acknowledge it is intentionally unused.',
        )
      }
    }
    return null
  },
}
