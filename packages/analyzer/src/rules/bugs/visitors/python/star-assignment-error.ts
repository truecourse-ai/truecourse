import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects invalid starred assignment patterns:
 * - F621: Too many expressions in a starred assignment (a, *b, c, d = ...)
 * - F622: Multiple starred expressions in a single assignment (a, *b, *c = ...)
 *
 * Python allows only ONE starred expression per assignment target.
 */
export const pythonStarAssignmentErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/star-assignment-error',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left) return null

    // Look for tuple/list pattern on the left side
    function countStars(n: import('web-tree-sitter').Node): number {
      if (n.type === 'list_splat_pattern' || n.type === 'dictionary_splat_pattern') return 1
      if (n.type === 'starred_expression') return 1
      let count = 0
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) count += countStars(child)
      }
      return count
    }

    // Only check tuple/list targets
    if (left.type !== 'pattern_list' && left.type !== 'tuple_pattern' && left.type !== 'list_pattern') return null

    const starCount = countStars(left)

    if (starCount > 1) {
      return makeViolation(
        this.ruleKey, left, filePath, 'high',
        'Multiple starred expressions in assignment',
        `Assignment target \`${left.text}\` contains ${starCount} starred expressions — Python only allows one starred expression per assignment.`,
        sourceCode,
        'Use at most one starred expression in an assignment target.',
      )
    }

    return null
  },
}
