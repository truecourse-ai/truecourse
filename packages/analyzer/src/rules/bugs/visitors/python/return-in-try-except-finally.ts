import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: return in finally block — overrides returns in try/except
export const pythonReturnInTryExceptFinallyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/return-in-try-except-finally',
  languages: ['python'],
  nodeTypes: ['finally_clause'],
  visit(node, filePath, sourceCode) {
    // Walk the finally clause body looking for return statements
    // But don't go into nested functions
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    const returnStmt = findDirectReturn(body)
    if (!returnStmt) return null

    return makeViolation(
      this.ruleKey, returnStmt, filePath, 'medium',
      'Return in finally block',
      '`return` in a `finally` block silently overrides any `return` or raised exception in the `try`/`except` blocks — confusing control flow.',
      sourceCode,
      'Remove the `return` from the `finally` block. If you need the return value, store it in a variable before the try/finally.',
    )
  },
}

function findDirectReturn(node: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
  for (const child of node.namedChildren) {
    if (child.type === 'return_statement') return child
    // Don't recurse into nested functions
    if (child.type === 'function_definition') continue
    const found = findDirectReturn(child)
    if (found) return found
  }
  return null
}
