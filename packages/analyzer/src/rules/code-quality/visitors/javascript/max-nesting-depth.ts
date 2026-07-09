import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

const MAX_DEPTH = 4

const NESTING_TYPES = new Set([
  'if_statement', 'for_statement', 'for_in_statement', 'while_statement',
  'do_statement', 'try_statement', 'switch_statement', 'with_statement',
])

/**
 * An `else if` parses as an `if_statement` nested in the parent if's
 * `else_clause`. It is a flat continuation of the same conditional, not real
 * nesting, so it must not add a level (matching ESLint's `max-depth`, which
 * treats an `if … else if … else` chain as a single level).
 */
function isElseIf(node: SyntaxNode): boolean {
  return node.type === 'if_statement' && node.parent?.type === 'else_clause'
}

function getNestingDepth(node: SyntaxNode): number {
  let depth = 0
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (NESTING_TYPES.has(current.type) && !isElseIf(current)) {
      depth++
    }
    // Stop at function boundary
    if (
      current.type === 'function_declaration' ||
      current.type === 'function' ||
      current.type === 'arrow_function' ||
      current.type === 'method_definition'
    ) {
      break
    }
    current = current.parent
  }
  return depth
}

export const maxNestingDepthVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/max-nesting-depth',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    // An `else if` is the same level as its chain head (which is measured
    // separately); deeper nesting inside its branch is caught on the inner
    // nodes. So don't measure or report the else-if node itself.
    if (isElseIf(node)) return null

    const depth = getNestingDepth(node)
    if (depth < MAX_DEPTH) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Block nested ${depth + 1} levels deep`,
      `Block is nested ${depth + 1} levels deep — maximum is ${MAX_DEPTH}. Extract logic into helper functions.`,
      sourceCode,
      'Extract the deeply nested code into a named function.',
    )
  },
}
