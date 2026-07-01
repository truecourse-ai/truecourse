import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames, isCSharpGeneratedSource, isCSharpPrivateMember } from './_helpers.js'

/**
 * Private fields / properties / events never referenced inside the class.
 * Methods are owned by unused-private-method; nested types by
 * unused-private-nested-class — the three keys never double-fire.
 */
export const csharpUnusedPrivateMemberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-private-member',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (isCSharpGeneratedSource(filePath, sourceCode)) return null
    // Other partial-class files may reference the member.
    if (hasCSharpModifier(node, 'partial')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const privateMembers = new Map<string, SyntaxNode>()
    for (const member of body.namedChildren) {
      if (!member) continue
      // Explicit interface implementations (`T IFoo.Bar => ...`) are contract
      // members accessed through the interface, not private members — never
      // "unused". They carry no access modifier, so without this guard they read
      // as default-private.
      if (member.namedChildren.some((c) => c?.type === 'explicit_interface_specifier')) continue
      if (!isCSharpPrivateMember(member)) continue
      // Attribute-decorated members are reached via reflection
      // (serializers, DI, Unity [SerializeField], …).
      if (getCSharpDeclAttributeNames(member).length > 0) continue

      if (member.type === 'field_declaration' || member.type === 'event_field_declaration') {
        const decl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
        for (const d of decl?.namedChildren ?? []) {
          if (d?.type !== 'variable_declarator') continue
          const nameNode = d.childForFieldName('name')
          if (nameNode) privateMembers.set(nameNode.text, nameNode)
        }
      } else if (member.type === 'property_declaration') {
        const nameNode = member.childForFieldName('name')
        if (nameNode) privateMembers.set(nameNode.text, nameNode)
      }
    }

    if (privateMembers.size === 0) return null

    // Any identifier occurrence other than the declarator itself counts as a
    // use (covers `this.X`, bare `X`, `nameof(X)`, and conservatively also
    // same-named members of other objects).
    const usedIds = new Map<string, number>()
    for (const [name, nameNode] of privateMembers) usedIds.set(name, nameNode.id)

    const used = new Set<string>()
    function walk(n: SyntaxNode) {
      if (n.type === 'identifier') {
        const declId = usedIds.get(n.text)
        if (declId !== undefined && n.id !== declId) used.add(n.text)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }
    walk(body)

    for (const [name, nameNode] of privateMembers) {
      if (!used.has(name)) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'medium',
          'Unused private member',
          `Private member \`${name}\` is never accessed. Remove it or use it.`,
          sourceCode,
          'Remove the unused private member or access it somewhere in the class.',
        )
      }
    }
    return null
  },
}
