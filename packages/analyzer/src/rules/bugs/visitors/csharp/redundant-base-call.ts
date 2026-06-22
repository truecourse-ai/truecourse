import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Nearest enclosing class/struct/record declaration, or null. */
function enclosingType(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (
      current.type === 'class_declaration' ||
      current.type === 'struct_declaration' ||
      current.type === 'record_declaration' ||
      current.type === 'record_struct_declaration'
    ) {
      return current
    }
    current = current.parent
  }
  return null
}

/** Names of members (methods/properties/events/fields) the type itself declares. */
function declaredMemberNames(typeDecl: SyntaxNode): Set<string> {
  const names = new Set<string>()
  const body = typeDecl.childForFieldName('body')
  if (!body) return names
  for (const member of body.namedChildren) {
    if (!member) continue
    if (
      member.type === 'method_declaration' ||
      member.type === 'property_declaration'
    ) {
      const n = member.childForFieldName('name')?.text
      if (n) names.add(n)
    } else if (
      member.type === 'field_declaration' ||
      member.type === 'event_field_declaration'
    ) {
      const decl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
      for (const d of decl?.namedChildren ?? []) {
        if (d?.type === 'variable_declarator') {
          const n = d.childForFieldName('name')?.text
          if (n) names.add(n)
        }
      }
    }
  }
  return names
}

/**
 * `base.Member(...)` / `base.Member` where the enclosing type declares no
 * member of that name to shadow or override. With nothing to disambiguate from,
 * the `base.` qualifier is redundant and can mislead a reader into thinking it
 * skips a local override. Only fires when the type provably declares no
 * same-named member, so an actual override still uses `base.` safely.
 */
export const csharpRedundantBaseCallVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/redundant-base-call',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = node.childForFieldName('expression')
    if (receiver?.type !== 'base' && receiver?.text !== 'base') return null
    const memberName = node.childForFieldName('name')?.text
    if (!memberName) return null

    const typeDecl = enclosingType(node)
    if (!typeDecl) return null

    if (declaredMemberNames(typeDecl).has(memberName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant base-qualified access',
      `The enclosing type declares no \`${memberName}\` member, so the \`base.\` qualifier is unnecessary and may mislead readers about which member runs.`,
      sourceCode,
      'Remove the redundant `base.` qualifier.',
    )
  },
}
