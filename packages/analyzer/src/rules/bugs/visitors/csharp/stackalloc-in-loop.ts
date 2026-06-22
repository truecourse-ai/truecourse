import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES, CSHARP_LOOP_TYPES } from './_helpers.js'

/**
 * `stackalloc` inside a loop body. Stack memory allocated with `stackalloc` is
 * not released until the enclosing method returns, so allocating on each
 * iteration accumulates and can overflow the stack. The buffer should be
 * allocated once outside the loop.
 *
 * Walking stops at nested function boundaries (a lambda/local function inside
 * the loop is a separate stack frame), so only a `stackalloc` whose own
 * enclosing function is the looping one is reported.
 */
function isInLoopWithinSameFunction(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (CSHARP_FUNCTION_BOUNDARIES.has(current.type)) return false
    if (CSHARP_LOOP_TYPES.has(current.type)) return true
    current = current.parent
  }
  return false
}

export const csharpStackallocInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/stackalloc-in-loop',
  languages: ['csharp'],
  nodeTypes: ['stackalloc_expression'],
  visit(node, filePath, sourceCode) {
    if (!isInLoopWithinSameFunction(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'stackalloc inside a loop',
      'This stackalloc runs every iteration, but the stack memory is not released until the method returns — repeated allocation can overflow the stack.',
      sourceCode,
      'Allocate the buffer once before the loop and reuse it on each iteration.',
    )
  },
}
