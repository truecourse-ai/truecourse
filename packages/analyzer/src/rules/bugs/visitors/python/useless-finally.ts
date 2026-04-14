import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects finally blocks that contain only pass statements or are empty.
 * These serve no purpose.
 */
export const pythonUselessFinallyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-finally',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    // Find the finally clause
    let finallyClause: import('tree-sitter').SyntaxNode | null = null

    for (const child of node.namedChildren) {
      if (child.type === 'finally_clause') {
        finallyClause = child
        break
      }
    }

    if (!finallyClause) return null

    // Get the body of the finally clause
    // The body is usually a block with statements
    const body = finallyClause.namedChildren.filter((c) => c.type !== 'finally')

    // Check if body is empty or only has pass
    const isUseless = body.every((stmt) => {
      if (stmt.type === 'pass_statement') return true
      if (stmt.type === 'block') {
        return stmt.namedChildren.every((s) => s.type === 'pass_statement')
      }
      return false
    })

    if (isUseless) {
      return makeViolation(
        this.ruleKey, finallyClause, filePath, 'low',
        'Useless finally block',
        'The `finally` block contains only `pass` statements and serves no purpose — remove it.',
        sourceCode,
        'Remove the empty `finally: pass` block.',
      )
    }

    return null
  },
}
