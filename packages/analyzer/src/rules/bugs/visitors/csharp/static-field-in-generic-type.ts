import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Whether the field carries a given modifier keyword. */
function hasModifier(field: SyntaxNode, keyword: string): boolean {
  return field.children.some((c) => c?.type === 'modifier' && c.text === keyword)
}

/**
 * A static field declared in a generic type. Each distinct closed generic type
 * (`Cache<int>`, `Cache<string>`, …) gets its own independent copy of the
 * static field — a frequent source of surprise when a developer expects one
 * shared value. `const` fields are compile-time constants (no per-instantiation
 * storage) and are not flagged.
 *
 * Only fires for a type that declares its own type parameters; a non-generic
 * nested type inside a generic outer type is left to a separate concern.
 */
export const csharpStaticFieldInGenericTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/static-field-in-generic-type',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasModifier(node, 'static') || hasModifier(node, 'const')) return null

    // The directly enclosing type must declare type parameters.
    const typeDecl = node.parent?.parent
    if (
      typeDecl?.type !== 'class_declaration' &&
      typeDecl?.type !== 'struct_declaration' &&
      typeDecl?.type !== 'record_declaration'
    ) {
      return null
    }
    const typeParams = typeDecl.namedChildren.find((c) => c?.type === 'type_parameter_list')
    if (!typeParams) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Static field in a generic type',
      'A static field in a generic type gets a separate copy per closed generic type, which surprises developers expecting a single shared value.',
      sourceCode,
      'Move the static field to a non-generic base or helper type if a single shared value is intended.',
    )
  },
}
