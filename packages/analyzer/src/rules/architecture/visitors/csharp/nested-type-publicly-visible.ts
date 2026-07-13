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

/**
 * A `static` class whose members are all constant-like names — `const` /
 * `static` fields — or nested classes that are themselves constant containers is
 * an intentional namespacing idiom: grouping related names (permission keys,
 * bundle names, option names, error codes) under an owning type, not a leaked
 * implementation helper. Such a container is deliberately public and should not
 * be flagged. Both the flat form (all const/static fields) and the grouped form
 * (nested static holder classes, e.g. `Permissions { Blogs {…}, Posts {…} }`)
 * qualify; a `static` field need not be `readonly`, since bundle-name holders
 * often expose plain mutable `public static string` fields.
 */
function isConstantContainer(node: SyntaxNode): boolean {
  if (node.type !== 'class_declaration') return false
  if (!hasCSharpModifier(node, 'static')) return false
  const body = node.childForFieldName('body')
  if (!body) return false
  const members = body.namedChildren.filter((c) => c && c.type !== 'comment')
  if (members.length === 0) return false
  return members.every((m) => {
    if (!m) return false
    if (m.type === 'field_declaration')
      return hasCSharpModifier(m, 'const') || hasCSharpModifier(m, 'static')
    // Nested grouping classes that are themselves constant containers keep the
    // whole file a single cohesive constants namespace.
    if (m.type === 'class_declaration') return isConstantContainer(m)
    return false
  })
}

export const csharpNestedTypePubliclyVisibleVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/nested-type-publicly-visible',
  languages: ['csharp'],
  nodeTypes: ['class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration'],
  visit(node, filePath, sourceCode) {
    if (!isNestedInType(node)) return null
    if (!hasCSharpModifier(node, 'public') && !hasCSharpModifier(node, 'protected')) return null
    if (getCSharpAttributeNames(node).length > 0) return null
    if (isConstantContainer(node)) return null

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
