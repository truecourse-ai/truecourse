import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A type whose members are all static is a "static holder". When it is not
 * declared `static`, an explicit public/internal instance constructor lets
 * callers create an instance that serves no purpose — there is no instance
 * state to construct. The constructor should be removed (and the type made
 * `static`). The check fires only when every non-constructor member is static
 * or `const`, so it never touches a type with genuine instance members.
 */

const INSTANTIABLE_MEMBER_TYPES = new Set([
  'field_declaration', 'method_declaration', 'property_declaration',
  'event_field_declaration', 'event_declaration', 'indexer_declaration',
])

function isStaticMember(member: SyntaxNode): boolean {
  return hasCSharpModifier(member, 'static') || hasCSharpModifier(member, 'const')
}

export const csharpStaticHolderTypeHasConstructorVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/static-holder-type-has-constructor',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (hasCSharpModifier(node, 'static')) return null
    if (hasCSharpModifier(node, 'abstract')) return null

    // A type that derives from a base class inherits instance state and is
    // genuinely instantiated through the hierarchy, so its constructor is not a
    // static-holder artifact. (A type listing a base also cannot be made
    // `static`, so the rule's fix would not apply.) Skip any type with a base
    // list — the "all members static" shape only implies a static holder for a
    // standalone type.
    if (node.namedChildren.some((c) => c?.type === 'base_list')) return null

    const body = node.namedChildren.find((c) => c?.type === 'declaration_list')
    if (!body) return null

    const members = body.namedChildren.filter((c): c is SyntaxNode => c != null)

    // Find a non-static, parameterless, externally-callable instance constructor.
    let offendingCtor: SyntaxNode | null = null
    let hasInstantiableMember = false
    let memberCount = 0

    for (const member of members) {
      if (member.type === 'constructor_declaration') {
        if (hasCSharpModifier(member, 'static')) continue
        if (hasCSharpModifier(member, 'private')) return null
        const params = member.namedChildren.find((c) => c?.type === 'parameter_list')
        if (params && params.namedChildCount > 0) return null
        offendingCtor = member
        continue
      }
      if (INSTANTIABLE_MEMBER_TYPES.has(member.type)) {
        memberCount++
        if (!isStaticMember(member)) hasInstantiableMember = true
      }
    }

    if (!offendingCtor || hasInstantiableMember || memberCount === 0) return null

    return makeViolation(
      this.ruleKey, offendingCtor, filePath, 'low',
      'Static holder type has instance constructor',
      'A type with only static members declares a public instance constructor that serves no purpose, since no instance is ever needed.',
      sourceCode,
      'Remove the instance constructor and mark the type `static`.',
    )
  },
}
