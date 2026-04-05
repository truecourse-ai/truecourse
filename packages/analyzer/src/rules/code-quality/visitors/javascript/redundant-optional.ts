import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

export const redundantOptionalVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-optional',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['optional_parameter', 'property_signature', 'public_field_definition'],
  visit(node, filePath, sourceCode) {
    const isOptional = node.children.some((c) => c.text === '?')
    if (!isOptional) return null

    const typeAnnotation = node.namedChildren.find((c) => c.type === 'type_annotation')
    if (!typeAnnotation) return null

    function hasUndefinedMember(n: SyntaxNode): boolean {
      if (n.type === 'predefined_type' && n.text === 'undefined') return true
      if (n.type === 'literal_type' && n.text === 'undefined') return true
      if (n.type === 'union_type') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child && hasUndefinedMember(child)) return true
        }
        return false
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child && hasUndefinedMember(child)) return true
      }
      return false
    }

    if (hasUndefinedMember(typeAnnotation)) {
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
