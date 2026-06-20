import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A type declared outside any namespace lands in the global namespace, where it
 * pollutes every consumer's name resolution and risks clashing with types from
 * referenced assemblies (S3903). The check fires on a top-level
 * class/struct/interface/record/enum/delegate whose ancestor chain contains no
 * namespace declaration (block or file-scoped).
 *
 * Nested types are skipped — their enclosing type already scopes them.
 */

const TYPE_DECL_TYPES = new Set([
  'class_declaration', 'struct_declaration', 'interface_declaration',
  'record_declaration', 'record_struct_declaration', 'enum_declaration',
  'delegate_declaration',
])

function isTopLevel(node: SyntaxNode): boolean {
  // Direct child of the compilation unit — not nested in a type or namespace.
  return node.parent?.type === 'compilation_unit'
}

/**
 * A `file_scoped_namespace_declaration` is a sibling under the compilation
 * unit, not an ancestor: everything declared after it belongs to that
 * namespace. So a top-level type is global only when no file-scoped namespace
 * precedes it (and it has no block-namespace ancestor, which the top-level
 * check already rules out for block namespaces).
 */
function inGlobalNamespace(node: SyntaxNode): boolean {
  const unit = node.parent
  if (!unit) return false
  for (const sibling of unit.namedChildren) {
    if (!sibling) continue
    if (sibling.id === node.id) break
    if (sibling.type === 'file_scoped_namespace_declaration') return false
  }
  return true
}

export const csharpTypeInGlobalNamespaceVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/type-in-global-namespace',
  languages: ['csharp'],
  nodeTypes: [...TYPE_DECL_TYPES],
  visit(node, filePath, sourceCode) {
    if (!isTopLevel(node)) return null
    if (!inGlobalNamespace(node)) return null

    const name = node.childForFieldName('name')?.text ?? 'type'
    const nameNode = node.childForFieldName('name') ?? node
    return makeViolation(
      this.ruleKey, nameNode, filePath, 'low',
      'Type in the global namespace',
      `Type \`${name}\` is declared outside any namespace, polluting the global namespace and risking clashes with types from referenced assemblies (S3903).`,
      sourceCode,
      `Move \`${name}\` into a named namespace.`,
    )
  },
}
