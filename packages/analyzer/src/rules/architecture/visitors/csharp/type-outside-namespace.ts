import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A type declared in the global namespace risks name collisions and signals
 * poor organisation. Fired on a top-level type whose parent is the compilation
 * unit and which is not covered by a file-scoped namespace declaration.
 *
 * A `file_scoped_namespace_declaration` applies to everything *after* it, so a
 * type is global only when it precedes any file-scoped namespace (and isn't
 * nested in a block `namespace_declaration`, which the parent check rules out).
 */
export const csharpTypeOutsideNamespaceVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/type-outside-namespace',
  languages: ['csharp'],
  nodeTypes: ['class_declaration', 'struct_declaration', 'interface_declaration', 'enum_declaration', 'record_declaration', 'delegate_declaration'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (parent?.type !== 'compilation_unit') return null

    // Covered by a file-scoped namespace that appears earlier in the file?
    let sibling: SyntaxNode | null = node.previousNamedSibling
    while (sibling) {
      if (sibling.type === 'file_scoped_namespace_declaration') return null
      sibling = sibling.previousNamedSibling
    }
    const name = node.childForFieldName('name')?.text ?? 'type'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Type declared outside a namespace',
      `Type '${name}' is declared in the global namespace, risking name collisions and poor organisation.`,
      sourceCode,
      `Wrap '${name}' in a namespace (file-scoped: \`namespace Your.Namespace;\`).`,
    )
  },
}
