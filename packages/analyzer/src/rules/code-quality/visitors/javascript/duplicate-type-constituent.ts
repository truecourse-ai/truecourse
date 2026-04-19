import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const duplicateTypeConstituentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-type-constituent',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['union_type', 'intersection_type'],
  visit(node, filePath, sourceCode) {
    if (node.parent?.type === node.type) return null

    function flatten(n: SyntaxNode): string[] {
      if (n.type === node.type) {
        const results: string[] = []
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child) results.push(...flatten(child))
        }
        return results
      }
      return [n.text.trim()]
    }

    const members = flatten(node)
    const seen = new Set<string>()
    for (const m of members) {
      if (seen.has(m)) {
        const typeWord = node.type === 'union_type' ? 'Union' : 'Intersection'
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Duplicate type constituent',
          `${typeWord} type contains duplicate member \`${m}\`.`,
          sourceCode,
          `Remove the duplicate \`${m}\` from the type.`,
        )
      }
      seen.add(m)
    }
    return null
  },
}
