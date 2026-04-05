import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsidePythonLoop } from './_helpers.js'

export const quadraticListSummationVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/quadratic-list-summation',
  languages: ['python'],
  nodeTypes: ['augmented_assignment'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '+=')
    if (!op) return null

    const left = node.childForFieldName('left')
    if (!left) return null

    // Check if the right side is a string or the left is being used as string concat
    const right = node.childForFieldName('right')
    if (!right) return null

    // Heuristic: if += is used inside a loop with string-like values
    if (!isInsidePythonLoop(node)) return null

    // Check if right side is string-like: literal, f-string, str() call, concatenation, or any expression
    const rightType = right.type
    const rightText = right.text
    const isStringLike =
      rightType === 'string' ||
      rightType === 'concatenated_string' ||
      rightType === 'binary_operator' ||
      rightType === 'call' && (rightText.startsWith('str(') || rightText.startsWith('f"') || rightText.startsWith("f'"))

    if (isStringLike) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'String concatenation with += in loop',
        'Building a string with += in a loop creates O(n^2) copies. Use str.join() or a list instead.',
        sourceCode,
        'Collect parts in a list and use "".join(parts) after the loop.',
      )
    }

    return null
  },
}
