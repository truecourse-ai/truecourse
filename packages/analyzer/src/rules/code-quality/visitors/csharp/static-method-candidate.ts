import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames, isCSharpPrivateMember } from './_helpers.js'

const POLYMORPHIC_MODIFIERS = ['static', 'virtual', 'override', 'abstract', 'partial', 'extern', 'new']

/**
 * Instance-member names declared on the class. Used to detect implicit
 * instance access (C# does not require `this.` for member access).
 */
function collectInstanceMemberNames(classBody: SyntaxNode, exceptMethodId: number): Set<string> {
  const names = new Set<string>()
  for (const member of classBody.namedChildren) {
    if (!member) continue
    if (hasCSharpModifier(member, 'static') || hasCSharpModifier(member, 'const')) continue
    if (member.type === 'field_declaration' || member.type === 'event_field_declaration') {
      const decl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
      for (const d of decl?.namedChildren ?? []) {
        if (d?.type !== 'variable_declarator') continue
        const name = d.childForFieldName('name')?.text
        if (name) names.add(name)
      }
    } else if (member.type === 'property_declaration' || member.type === 'method_declaration'
      || member.type === 'event_declaration' || member.type === 'indexer_declaration') {
      if (member.id === exceptMethodId) continue
      const name = member.childForFieldName('name')?.text
      if (name) names.add(name)
    }
  }
  return names
}

function usesInstanceState(body: SyntaxNode, instanceMembers: Set<string>): boolean {
  if (body.type === 'this_expression' || body.type === 'base_expression') return true
  if (body.type === 'identifier' && instanceMembers.has(body.text)) {
    // A member-access NAME under a non-this receiver (`order.Total`) is the
    // other object's member, not ours. Bare identifiers and `this.X` count.
    const parent = body.parent
    const isForeignMemberName = (parent?.type === 'member_access_expression'
      || parent?.type === 'member_binding_expression'
      || parent?.type === 'qualified_name')
      && parent.childForFieldName('name')?.id === body.id
      && parent.childForFieldName('expression')?.type !== 'this_expression'
    if (!isForeignMemberName) return true
  }
  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i)
    if (child && usesInstanceState(child, instanceMembers)) return true
  }
  return false
}

/**
 * Mirrors Sonar S2325: only private/protected methods are flagged — public
 * methods on concrete classes are often kept non-static deliberately for DI
 * registration and mocking, which would be false positives.
 */
export const csharpStaticMethodCandidateVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/static-method-candidate',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const classBody = node.parent
    const classNode = classBody?.parent
    if (classBody?.type !== 'declaration_list' || classNode?.type !== 'class_declaration') return null

    // Base types / interfaces may dictate instance dispatch; a partial class
    // may keep its state in another file; abstract classes exist for override.
    if (classNode.namedChildren.some((c) => c?.type === 'base_list')) return null
    if (hasCSharpModifier(classNode, 'partial')) return null
    if (hasCSharpModifier(classNode, 'abstract')) return null

    if (POLYMORPHIC_MODIFIERS.some((m) => hasCSharpModifier(node, m))) return null
    if (!isCSharpPrivateMember(node) && !hasCSharpModifier(node, 'protected')) return null
    // Attribute-routed methods (event wiring, serialization hooks) are
    // invoked by frameworks that may require instance methods.
    if (getCSharpDeclAttributeNames(node).length > 0) return null
    if (node.namedChildren.some((c) => c?.type === 'explicit_interface_specifier')) return null

    const name = node.childForFieldName('name')?.text
    if (!name || name === 'Main') return null

    const body = node.childForFieldName('body')
      ?? node.namedChildren.find((c) => c?.type === 'arrow_expression_clause')
    if (!body) return null
    if (body.type === 'block' && body.namedChildren.filter(Boolean).length === 0) return null

    const instanceMembers = collectInstanceMemberNames(classBody, node.id)
    if (usesInstanceState(body, instanceMembers)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Static method candidate',
      `Method \`${name}\` does not use any instance state — consider making it static.`,
      sourceCode,
      `Add the \`static\` modifier to \`${name}\`.`,
    )
  },
}
