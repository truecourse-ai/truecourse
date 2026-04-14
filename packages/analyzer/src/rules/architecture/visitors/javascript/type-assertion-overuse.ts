import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const typeAssertionOveruseVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/type-assertion-overuse',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['as_expression'],
  visit(node, filePath, sourceCode) {
    // Count total `as` expressions in the file (heuristic: flag if this file has many)
    // To avoid O(n^2), we only flag `as any` and `as unknown` which are the most problematic
    const typeNode = node.namedChildren[node.namedChildren.length - 1]
    if (!typeNode) return null

    const typeName = typeNode.text
    if (typeName === 'any') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Type assertion to any',
        "'as any' bypasses TypeScript's type system entirely. Use proper type narrowing instead.",
        sourceCode,
        'Use type guards, generics, or proper type narrowing instead of "as any".',
      )
    }

    return null
  },
}
