import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from './_helpers.js'

export const uselessTypeIntersectionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-type-intersection',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['intersection_type'],
  visit(node, filePath, sourceCode) {
    if (node.parent?.type === 'intersection_type') return null

    function flatten(n: SyntaxNode): string[] {
      if (n.type === 'intersection_type') {
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

    if (members.includes('never')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless type intersection with never',
        '`T & never` always resolves to `never`. Remove the `never` member or check the type logic.',
        sourceCode,
        'Remove the `never` from the intersection or rethink the type.',
      )
    }

    if (members.includes('any')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Useless type intersection with any',
        '`T & any` always resolves to `any`. This defeats the purpose of the intersection.',
        sourceCode,
        'Remove the `any` from the intersection.',
      )
    }

    return null
  },
}
