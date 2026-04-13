import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

const LOOP_TYPES = new Set(['for_statement', 'while_statement'])

/**
 * Walk up from `node` through nested blocks and check whether the jump is
 * truly the last executable statement in its enclosing compound block (loop
 * body or function body). A `continue` at the end of an `if` block inside a
 * loop is only redundant when the `if` itself is the last statement in the
 * loop body — otherwise the `continue` actually skips code that follows.
 */
function isLastInEnclosingBlock(node: SyntaxNode, stopType: 'loop' | 'function'): boolean {
  let current: SyntaxNode | null = node
  while (current) {
    const parentBlock: SyntaxNode | null = current.parent
    if (!parentBlock || parentBlock.type !== 'block') return false

    // The node must be the last statement in this block
    const stmts = parentBlock.namedChildren
    if (stmts[stmts.length - 1]?.id !== current.id) return false

    const owner: SyntaxNode | null = parentBlock.parent
    if (!owner) return false

    if (stopType === 'function' && owner.type === 'function_definition') return true
    if (stopType === 'loop' && LOOP_TYPES.has(owner.type)) return true

    // If the owner is an if/elif/else/try/except/with, keep walking up
    // — the jump is only redundant if ALL enclosing blocks are also at the tail.
    if (
      owner.type === 'if_statement' ||
      owner.type === 'elif_clause' ||
      owner.type === 'else_clause' ||
      owner.type === 'try_statement' ||
      owner.type === 'except_clause' ||
      owner.type === 'finally_clause' ||
      owner.type === 'with_statement'
    ) {
      current = owner
      continue
    }

    // Reached a non-compound-statement boundary — not redundant
    return false
  }
  return false
}

export const pythonRedundantJumpVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-jump',
  languages: ['python'],
  nodeTypes: ['return_statement', 'continue_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'return_statement') {
      // return with a value is not redundant
      if (node.namedChildren.length > 0) return null

      if (!isLastInEnclosingBlock(node, 'function')) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant return',
        'return at the end of a function with no value is unnecessary.',
        sourceCode,
        'Remove the redundant return statement.',
      )
    }

    if (node.type === 'continue_statement') {
      if (!isLastInEnclosingBlock(node, 'loop')) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant continue',
        'continue at the end of a loop body is unnecessary.',
        sourceCode,
        'Remove the redundant continue statement.',
      )
    }

    return null
  },
}
