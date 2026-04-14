import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'
import type { SyntaxNode } from 'tree-sitter'

export const unusedVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-variable',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const declared = new Map<string, SyntaxNode>()
    const read = new Set<string>()

    function collectDeclarations(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return
      if ((n.type === 'variable_declaration' || n.type === 'lexical_declaration')) {
        for (const declarator of n.namedChildren) {
          if (declarator.type === 'variable_declarator') {
            const nameNode = declarator.childForFieldName('name')
            if (nameNode && nameNode.type === 'identifier') {
              declared.set(nameNode.text, nameNode)
            }
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectDeclarations(child)
      }
    }

    function collectReads(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) {
        collectReadsUnscoped(n)
        return
      }
      if (n.type === 'identifier' || n.type === 'shorthand_property_identifier') {
        const parent = n.parent
        if (parent) {
          if ((parent.type === 'assignment_expression' || parent.type === 'augmented_assignment_expression')
            && parent.childForFieldName('left')?.id === n.id) return
          if (parent.type === 'variable_declarator' && parent.childForFieldName('name')?.id === n.id) return
          if (parent.type === 'for_in_statement' && parent.childForFieldName('left')?.id === n.id) return
        }
        read.add(n.text)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectReads(child)
      }
    }

    function collectReadsUnscoped(n: SyntaxNode) {
      if (n.type === 'identifier' || n.type === 'shorthand_property_identifier') read.add(n.text)
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectReadsUnscoped(child)
      }
    }

    collectDeclarations(bodyNode)
    collectReads(bodyNode)

    for (const [name, nameNode] of declared) {
      if (!read.has(name) && !name.startsWith('_')) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'medium',
          'Unused variable',
          `Variable \`${name}\` is declared but never read. Remove it or prefix with _ to mark as intentionally unused.`,
          sourceCode,
          'Remove the unused variable or prefix its name with _ to acknowledge it is intentionally unused.',
        )
      }
    }
    return null
  },
}
