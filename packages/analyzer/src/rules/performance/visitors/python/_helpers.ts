import type { SyntaxNode } from 'tree-sitter'

export const PYTHON_LOOP_TYPES = new Set([
  'for_statement',
  'while_statement',
])

export function isInsidePythonLoop(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (PYTHON_LOOP_TYPES.has(current.type)) return true
    // Stop at function boundaries
    if (current.type === 'function_definition') return false
    current = current.parent
  }
  return false
}
