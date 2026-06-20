import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A `static` member on a generic type must be reached by spelling out the type
 * argument (`Cache<Order>.Default`), which reads awkwardly and is easily
 * confused with member-level type inference; each closed generic also gets its
 * own copy of the static (CA1000). The convention is to hang the member off a
 * non-generic companion type. The check fires on a `static` property, method,
 * or field-like event declared directly inside a generic
 * `class_declaration`/`struct_declaration`.
 *
 * Static *fields* are intentionally excluded — `bugs/static-field-in-generic-type`
 * (S2743) already owns that node, and double-flagging the same declaration is
 * noise. `const` members and static constructors are exempt: a constant is a
 * shared compile-time value, and a static constructor must live on the type.
 */

function memberName(member: SyntaxNode): string {
  if (member.type === 'event_field_declaration') {
    const decl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
    const declarator = decl?.namedChildren.find((c) => c?.type === 'variable_declarator')
    return declarator?.childForFieldName('name')?.text ?? declarator?.namedChildren[0]?.text ?? 'member'
  }
  return member.childForFieldName('name')?.text ?? 'member'
}

export const csharpStaticMemberOnGenericTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/static-member-on-generic-type',
  languages: ['csharp'],
  nodeTypes: ['property_declaration', 'method_declaration', 'event_field_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'static')) return null
    // A compile-time constant on a generic type is shared safely; not flagged.
    if (hasCSharpModifier(node, 'const')) return null

    const owner = node.parent?.parent
    if (owner?.type !== 'class_declaration' && owner?.type !== 'struct_declaration') return null
    if (!owner.namedChildren.some((c) => c?.type === 'type_parameter_list')) return null

    const ownerName = owner.childForFieldName('name')?.text ?? 'type'
    const name = memberName(node)
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Static member on generic type',
      `Static member \`${name}\` lives on generic type \`${ownerName}\`, forcing callers to spell out the type argument and giving each closed generic its own copy (CA1000).`,
      sourceCode,
      `Move \`${name}\` to a non-generic companion type.`,
    )
  },
}
