import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: bare `raise` in finally block (not inside an except block)
// This causes unpredictable behavior
export const pythonBareRaiseInFinallyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/bare-raise-in-finally',
  languages: ['python'],
  nodeTypes: ['finally_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    // Find bare raise statements (not inside an except clause within finally)
    const bareRaise = findBareRaiseOutsideExcept(body)
    if (!bareRaise) return null

    return makeViolation(
      this.ruleKey, bareRaise, filePath, 'high',
      'Bare raise in finally block',
      'Bare `raise` in a `finally` block causes unpredictable behavior — it may re-raise a different exception than intended.',
      sourceCode,
      'Remove bare `raise` from `finally` blocks or explicitly re-raise the exception you intend.',
    )
  },
}

function findBareRaiseOutsideExcept(node: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
  for (const child of node.namedChildren) {
    // Don't go into nested try/except (except_clause would be inside them)
    if (child.type === 'except_clause') continue
    if (child.type === 'function_definition') continue

    if (child.type === 'raise_statement') {
      // Bare raise: no arguments after the raise keyword
      const hasExpr = child.namedChildren.length > 0
      if (!hasExpr) return child
    }

    const found = findBareRaiseOutsideExcept(child)
    if (found) return found
  }
  return null
}
