import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * An `abstract` class earns the `abstract` modifier when it is genuinely
 * designed to be extended rather than instantiated. The smell this rule targets
 * is a class marked `abstract` that offers **no reason at all** to be abstract:
 * no abstract members to implement, and no other design-for-extension signal —
 * it should simply be a concrete class (or a static holder).
 *
 * A class is legitimately abstract, and therefore exempt, when it carries any of
 * these signals:
 *   - an `abstract` member (the classic contract to implement);
 *   - a `virtual`/`override` member (a real extension/override point);
 *   - a `protected`/`protected internal` constructor (constructible only by
 *     subclasses — the definition of a base class);
 *   - a base list (extends a base class or implements an interface — it provides
 *     shared implementation of a hierarchy/contract).
 *
 * These signals are exactly what idiomatic framework bases carry (a Blazor
 * component base with `virtual` lifecycle hooks, a worker base implementing an
 * interface, a domain-service base with a protected ctor, an audited-entity base
 * extending another entity), so those are no longer flagged. Only a class that
 * is abstract for no structural reason remains a violation. Partial classes are
 * skipped because the signals may live in another file.
 */
const MEMBER_TYPES = new Set([
  'method_declaration', 'property_declaration', 'event_declaration',
  'event_field_declaration', 'indexer_declaration',
])

/** True when the class declares a member with the given modifier. */
function hasMemberWithModifier(body: SyntaxNode, modifier: string): boolean {
  return body.namedChildren.some(
    (c) => c != null && MEMBER_TYPES.has(c.type) && hasCSharpModifier(c, modifier),
  )
}

/** A constructor declared `protected` (or `protected internal`) — a base-class hallmark. */
function hasProtectedConstructor(body: SyntaxNode): boolean {
  return body.namedChildren.some(
    (c) => c?.type === 'constructor_declaration' && hasCSharpModifier(c, 'protected'),
  )
}

/** The class extends a base type or implements an interface. */
function hasBaseList(classDecl: SyntaxNode): boolean {
  return classDecl.namedChildren.some((c) => c?.type === 'base_list')
}

/** Any structural reason the class is legitimately non-instantiable. */
function hasExtensionSignal(classDecl: SyntaxNode, body: SyntaxNode): boolean {
  return (
    hasMemberWithModifier(body, 'abstract') ||
    hasMemberWithModifier(body, 'virtual') ||
    hasMemberWithModifier(body, 'override') ||
    hasProtectedConstructor(body) ||
    hasBaseList(classDecl)
  )
}

export const csharpAbstractClassWithoutAbstractMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/abstract-class-without-abstract-members',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'abstract')) return null
    if (hasCSharpModifier(node, 'partial')) return null

    const body = node.childForFieldName('body')
    if (!body) return null
    if (hasExtensionSignal(node, body)) return null

    const name = node.childForFieldName('name')?.text ?? 'class'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Abstract class without abstract members',
      `Abstract class \`${name}\` declares no abstract members and no other reason to be abstract (no virtual/override member, no protected constructor, no base type), so it should be a concrete class or a static holder instead.`,
      sourceCode,
      'Add abstract members, drop the `abstract` modifier, or convert the type to an interface.',
    )
  },
}
