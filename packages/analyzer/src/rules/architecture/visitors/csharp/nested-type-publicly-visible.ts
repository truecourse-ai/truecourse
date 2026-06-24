import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpAttributeNames, hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A nested type declared `public`/`protected` exposes an implementation detail
 * of its containing type through the outer type's API surface. Nested types are
 * usually helpers and should stay `private`/`internal`.
 *
 * Excluded: nested enums (an idiomatic, commonly-public way to scope a status
 * enum to its owner) and types carrying attributes (e.g. serializer DTOs whose
 * visibility is deliberate).
 */
const TYPE_DECL_TYPES = new Set([
  'class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration', 'record_struct_declaration',
])

function isNestedInType(node: SyntaxNode): boolean {
  const parent = node.parent
  if (parent?.type !== 'declaration_list') return false
  return parent.parent != null && TYPE_DECL_TYPES.has(parent.parent.type)
}

export const csharpNestedTypePubliclyVisibleVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/nested-type-publicly-visible',
  languages: ['csharp'],
  nodeTypes: ['class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration'],
  visit(node, filePath, sourceCode) {
    if (!isNestedInType(node)) return null
    if (!hasCSharpModifier(node, 'public') && !hasCSharpModifier(node, 'protected')) return null
    if (getCSharpAttributeNames(node).length > 0) return null

    const name = node.childForFieldName('name')?.text ?? 'type'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Publicly visible nested type',
      `Nested type '${name}' is publicly visible, exposing an implementation detail of its containing type.`,
      sourceCode,
      `Make '${name}' private or internal, or lift it out to its own top-level type if it is a real part of the API.`,
    )
  },
}
