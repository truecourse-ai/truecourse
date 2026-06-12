import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames, isCSharpGeneratedSource, isCSharpPrivateMember } from './_helpers.js'

/**
 * Private field that IS referenced — but only ever as a plain assignment
 * target — and never read: the stored value is dead. Disjoint from
 * unused-private-member (which owns fields with ZERO references): this rule
 * requires at least one assignment reference. Compound assignments, `++`,
 * `ref`/`out`, and `nameof` all count as reads (conservative).
 */
export const csharpUnreadPrivateAttributeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unread-private-attribute',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (isCSharpGeneratedSource(filePath, sourceCode)) return null
    if (hasCSharpModifier(node, 'partial')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const privateFields = new Map<string, SyntaxNode>()
    const declNodeIds = new Map<string, number>()
    for (const member of body.namedChildren) {
      if (member?.type !== 'field_declaration') continue
      if (!isCSharpPrivateMember(member)) continue
      // Attribute-decorated fields are read via reflection (serializers, DI).
      if (getCSharpDeclAttributeNames(member).length > 0) continue
      const varDecl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
      for (const declarator of varDecl?.namedChildren ?? []) {
        if (declarator?.type !== 'variable_declarator') continue
        const nameNode = declarator.childForFieldName('name')
        if (!nameNode) continue
        privateFields.set(nameNode.text, nameNode)
        declNodeIds.set(nameNode.text, nameNode.id)
      }
    }
    if (privateFields.size === 0) return null

    const written = new Set<string>()
    const read = new Set<string>()

    function classify(idNode: SyntaxNode): void {
      const name = idNode.text
      // The lvalue is either the bare identifier or the `this.x` access containing it.
      let lvalue: SyntaxNode = idNode
      const parent = idNode.parent
      if (parent?.type === 'member_access_expression'
        && parent.childForFieldName('name')?.id === idNode.id) {
        if (parent.childForFieldName('expression')?.type !== 'this_expression') {
          read.add(name) // someOther.x — same-named member elsewhere; be conservative
          return
        }
        lvalue = parent
      }
      const owner = lvalue.parent
      if (owner?.type === 'assignment_expression'
        && owner.childForFieldName('left')?.id === lvalue.id
        && owner.childForFieldName('operator')?.text === '=') {
        written.add(name)
        return
      }
      read.add(name)
    }

    function walk(n: SyntaxNode): void {
      if (n.type === 'identifier' && privateFields.has(n.text) && n.id !== declNodeIds.get(n.text)) {
        classify(n)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }
    walk(body)

    for (const [name, nameNode] of privateFields) {
      if (written.has(name) && !read.has(name)) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'low',
          'Private field written but never read',
          `Private field \`${name}\` is assigned but its value is never read — the stores are dead code.`,
          sourceCode,
          `Remove \`${name}\` and its assignments, or read it where the stored value was meant to be used.`,
        )
      }
    }
    return null
  },
}
