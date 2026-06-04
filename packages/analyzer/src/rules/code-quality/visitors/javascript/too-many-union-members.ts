import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const tooManyUnionMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-union-members',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['union_type'],
  visit(node, filePath, sourceCode) {
    if (node.parent?.type === 'union_type') return null

    // Skip unions in .d.ts files — these are externally-defined protocol enums
    if (filePath.endsWith('.d.ts')) return null

    // Skip unions inside type arguments (e.g., Pick<T, 'a' | 'b' | 'c'> — key unions, not type unions)
    let ancestor = node.parent
    while (ancestor) {
      if (ancestor.type === 'type_arguments') return null
      if (ancestor.type === 'type_alias_declaration' || ancestor.type === 'interface_declaration') break
      ancestor = ancestor.parent
    }

    // Per-member trailing comments (`'a' // ...`) and leading-`|`
    // artefacts show up as named children of `union_type` but aren't
    // members. Don't let them inflate the count.
    const NON_MEMBER_NODE_TYPES = new Set(['comment', 'ERROR', 'MISSING'])
    function countMembers(n: SyntaxNode): number {
      if (n.type !== 'union_type') return 1
      let total = 0
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (!child) continue
        if (NON_MEMBER_NODE_TYPES.has(child.type)) continue
        total += countMembers(child)
      }
      return total
    }

    const memberCount = countMembers(node)
    if (memberCount > 5) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many union members',
        `Union type has ${memberCount} members (max 5). Consider using an enum or a type alias for clarity.`,
        sourceCode,
        'Extract the union into a named type alias or use an enum.',
      )
    }
    return null
  },
}
