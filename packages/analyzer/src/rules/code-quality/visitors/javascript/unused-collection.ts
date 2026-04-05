import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'
import type { SyntaxNode } from 'tree-sitter'

export const unusedCollectionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-collection',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const collections = new Map<string, SyntaxNode>()

    function isCollectionInit(n: SyntaxNode): boolean {
      if (n.type === 'array') return true
      if (n.type === 'new_expression') {
        const ctor = n.childForFieldName('constructor')
        if (ctor?.text === 'Set' || ctor?.text === 'Map' || ctor?.text === 'Array') return true
      }
      return false
    }

    function collectDecls(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) return
      if (n.type === 'variable_declaration' || n.type === 'lexical_declaration') {
        for (const decl of n.namedChildren) {
          if (decl.type === 'variable_declarator') {
            const nameNode = decl.childForFieldName('name')
            const value = decl.childForFieldName('value')
            if (nameNode?.type === 'identifier' && value && isCollectionInit(value)) {
              collections.set(nameNode.text, nameNode)
            }
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectDecls(child)
      }
    }

    const reads = new Set<string>()
    function collectReads(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n !== node) {
        function markAll(m: SyntaxNode) {
          if (m.type === 'identifier') reads.add(m.text)
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
        if (parent) {
          if ((parent.type === 'variable_declarator') && parent.childForFieldName('name') === n) {
            // declaration — not a read
          } else if ((parent.type === 'assignment_expression') && parent.childForFieldName('left') === n) {
            // Pure assignment left side (x = something)
          } else {
            reads.add(n.text)
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectReads(child)
      }
    }

    collectDecls(bodyNode)
    collectReads(bodyNode)

    for (const [name, nameNode] of collections) {
      if (!reads.has(name) && !name.startsWith('_')) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'medium',
          'Unused collection',
          `Collection \`${name}\` is created but never read. Remove it or use it.`,
          sourceCode,
          'Remove the unused collection or use its contents somewhere.',
        )
      }
    }
    return null
  },
}
