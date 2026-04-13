import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsidePythonLoop } from './_helpers.js'

/**
 * Check if the variable is freshly assigned (reset) earlier in the same loop
 * body. If so, the += is a single concat per iteration — not quadratic.
 */
function isResetEarlierInLoop(node: SyntaxNode, varName: string): boolean {
  // Walk up to find the enclosing loop body (block)
  let loopBody: SyntaxNode | null = null
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'block' &&
        (current.parent?.type === 'for_statement' || current.parent?.type === 'while_statement')) {
      loopBody = current
      break
    }
    current = current.parent
  }
  if (!loopBody) return false

  // Check if there's a plain assignment (not augmented) to varName BEFORE this node in the loop body
  for (const child of loopBody.namedChildren) {
    // Stop when we reach the augmented assignment
    if (child.startIndex >= node.startIndex) break
    if (child.type === 'expression_statement') {
      const expr = child.namedChildren[0]
      if (expr?.type === 'assignment') {
        const target = expr.childForFieldName('left')
        if (target?.type === 'identifier' && target.text === varName) return true
      }
    }
  }
  return false
}

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
    const isStrCall = rightType === 'call' && right.childForFieldName('function')?.text === 'str'
    const isStringLike =
      rightType === 'string' ||
      rightType === 'concatenated_string' ||
      rightType === 'binary_operator' ||
      isStrCall

    if (!isStringLike) return null

    // Skip if the variable is reset (freshly assigned) earlier in the same loop
    // iteration — this means the string doesn't accumulate across iterations.
    const varName = left.type === 'identifier' ? left.text : null
    if (varName && isResetEarlierInLoop(node, varName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'String concatenation with += in loop',
      'Building a string with += in a loop creates O(n^2) copies. Use str.join() or a list instead.',
      sourceCode,
      'Collect parts in a list and use "".join(parts) after the loop.',
    )
  },
}
