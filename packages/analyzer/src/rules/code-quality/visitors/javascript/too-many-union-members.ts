import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

export const tooManyUnionMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-union-members',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['union_type'],
  visit(node, filePath, sourceCode) {
    if (node.parent?.type === 'union_type') return null

    function countMembers(n: SyntaxNode): number {
      if (n.type !== 'union_type') return 1
      let total = 0
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) total += countMembers(child)
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
