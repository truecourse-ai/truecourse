import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const redundantOptionalVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-optional',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['optional_parameter', 'property_signature', 'public_field_definition'],
  visit(node, filePath, sourceCode) {
    const isOptional = node.children.some((c) => c.text === '?')
    if (!isOptional) return null

    const typeAnnotation = node.namedChildren.find((c) => c.type === 'type_annotation')
    if (!typeAnnotation) return null

    // Unwrap the `type_annotation` (`: T`) wrapper to get the actual type node.
    const typeNode = typeAnnotation.namedChildren.find((c) => c.type !== 'comment')
    if (!typeNode) return null

    // Recognize `undefined` as either the `undefined` predefined keyword or a
    // literal-type wrapping it. We only treat the type as redundantly-undefined
    // when `undefined` appears at the TOP LEVEL of the annotation, i.e. either:
    //   - as a member of a union that is itself the top-level type, or
    //   - through parenthesized-type wrappers that don't change semantics.
    // We must NOT descend into nested constructors like function_type,
    // generic_type, object_type, array_type, tuple_type, mapped_type, etc. —
    // an `undefined` appearing inside e.g. `Record<string, string | undefined>`
    // or `(x: T | undefined) => void` is meaningful, not redundant.
    function isUndefinedType(n: SyntaxNode): boolean {
      if (n.type === 'predefined_type' && n.text === 'undefined') return true
      if (n.type === 'literal_type' && n.text === 'undefined') return true
      if (n.type === 'parenthesized_type') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child && isUndefinedType(child)) return true
        }
      }
      return false
    }

    function unionHasUndefined(n: SyntaxNode): boolean {
      if (n.type === 'parenthesized_type') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child && unionHasUndefined(child)) return true
        }
        return false
      }
      if (n.type !== 'union_type') return false
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (!child) continue
        if (isUndefinedType(child)) return true
        // Allow nested unions / parens within the top-level union.
        if (child.type === 'union_type' || child.type === 'parenthesized_type') {
          if (unionHasUndefined(child)) return true
        }
      }
      return false
    }

    if (unionHasUndefined(typeNode)) {
      const nameNode = node.childForFieldName('name') ?? node.childForFieldName('pattern')
      const name = nameNode?.text ?? 'property'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant optional with undefined',
        `\`${name}?\` already implies \`| undefined\` — the explicit \`| undefined\` is redundant.`,
        sourceCode,
        `Remove the explicit \`| undefined\` from the type annotation.`,
      )
    }
    return null
  },
}
