import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function isInsideExceptClause(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'except_clause') return true
    // Stop at function/class boundaries
    if (cur.type === 'function_definition' || cur.type === 'class_definition') return false
    cur = cur.parent
  }
  return false
}

export const pythonBareRaiseOutsideExceptVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/bare-raise-outside-except',
  languages: ['python'],
  nodeTypes: ['raise_statement'],
  visit(node, filePath, sourceCode) {
    // Bare raise: raise with no arguments
    if (node.namedChildren.length > 0) return null

    if (!isInsideExceptClause(node)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Bare raise outside except',
        'Bare `raise` used outside an `except` block — there is nothing to re-raise.',
        sourceCode,
        'Use `raise <ExceptionType>(...)` to raise a specific exception, or move inside an except block.',
      )
    }
    return null
  },
}
