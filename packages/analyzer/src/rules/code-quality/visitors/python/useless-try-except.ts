import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function bodyIsOnlyReraise(body: SyntaxNode, excVar: string | null): boolean {
  const stmts = body.namedChildren
  if (stmts.length !== 1) return false
  const stmt = stmts[0]
  if (stmt.type !== 'raise_statement') return false
  // Bare raise or raise excVar
  if (stmt.namedChildren.length === 0) return true
  if (excVar) {
    const expr = stmt.namedChildren[0]
    if (expr?.type === 'identifier' && expr.text === excVar) return true
  }
  return false
}

export const pythonUselessTryExceptVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-try-except',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    const exceptClauses = node.namedChildren.filter((c) => c.type === 'except_clause')
    if (exceptClauses.length === 0) return null

    // Check all except clauses only re-raise
    const allReraise = exceptClauses.every((exc) => {
      const body = exc.namedChildren.find((c) => c.type === 'block')
      if (!body) return false
      const asPattern = exc.namedChildren.find((c) => c.type === 'as_pattern')
      const excVar = asPattern?.namedChildren.find((c) => c.type === 'identifier')?.text ?? null
      return bodyIsOnlyReraise(body, excVar)
    })

    if (!allReraise) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Useless try-except',
      '`try-except` block that only re-raises serves no purpose — remove it.',
      sourceCode,
      'Remove the try-except block entirely.',
    )
  },
}
