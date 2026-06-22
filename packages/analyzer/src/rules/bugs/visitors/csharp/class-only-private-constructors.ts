import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Whether a member declaration carries a given access/kind modifier. */
function hasModifier(member: SyntaxNode, keyword: string): boolean {
  return member.children.some((c) => c?.type === 'modifier' && c.text === keyword)
}

const STATIC_BEARING_MEMBERS = new Set([
  'method_declaration',
  'property_declaration',
  'field_declaration',
  'operator_declaration',
  'conversion_operator_declaration',
])

const TYPE_MEMBERS = new Set([
  'class_declaration',
  'struct_declaration',
  'record_declaration',
  'enum_declaration',
  'interface_declaration',
])

/**
 * A non-static class whose every constructor is `private` and which exposes no
 * static member or nested type that could create or hand out an instance. With
 * no factory and no public/internal/protected constructor, the class can never
 * be instantiated — usually a forgotten `static` modifier or an accidentally
 * narrowed constructor.
 *
 * The rule bails out (no violation) the moment it sees any static member, a
 * nested type (a common factory/builder location), a non-private constructor, a
 * `static`/`abstract` class, or a base list (a derived class can chain to the
 * private constructor) — keeping it free of false positives.
 */
export const csharpClassOnlyPrivateConstructorsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/class-only-private-constructors',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (hasModifier(node, 'static') || hasModifier(node, 'abstract')) return null
    // A subclass could legitimately chain to a protected/private base ctor.
    if (node.namedChildren.some((c) => c?.type === 'base_list')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const constructors = body.namedChildren.filter(
      (c) => c?.type === 'constructor_declaration',
    ) as SyntaxNode[]
    if (constructors.length === 0) return null

    // Every constructor must be private (the implicit-public default does not
    // apply once an explicit constructor exists, but an explicit modifier other
    // than private clears the violation).
    for (const ctor of constructors) {
      const isPrivate = hasModifier(ctor, 'private')
      const isOtherAccess =
        hasModifier(ctor, 'public') ||
        hasModifier(ctor, 'internal') ||
        hasModifier(ctor, 'protected')
      if (!isPrivate || isOtherAccess) return null
    }

    // Any static member or nested type could provide an instantiation path.
    for (const member of body.namedChildren) {
      if (!member) continue
      if (TYPE_MEMBERS.has(member.type)) return null
      if (STATIC_BEARING_MEMBERS.has(member.type) && hasModifier(member, 'static')) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Class has only private constructors',
      'Every constructor of this class is private and there is no static factory or nested type to create an instance, so it can never be instantiated.',
      sourceCode,
      'Mark the class `static` if it is a utility, or add an accessible constructor or static factory.',
    )
  },
}
