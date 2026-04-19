import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

function countStatements(body: SyntaxNode): number {
  return body.namedChildren.length
}

export const pythonTryConsiderElseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/try-consider-else',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    const tryBody = node.childForFieldName('body')
    if (!tryBody) return null

    // Must have except clause
    const hasExcept = node.namedChildren.some((c) => c.type === 'except_clause')
    if (!hasExcept) return null

    // Must not already have else clause
    const hasElse = node.namedChildren.some((c) => c.type === 'else_clause')
    if (hasElse) return null

    // If the try body has more than one statement, the extra ones could be in else
    if (countStatements(tryBody) <= 1) return null

    // Check if the last statement(s) are not raise/return — those should stay in try
    const stmts = tryBody.namedChildren
    const lastStmt = stmts[stmts.length - 1]
    if (!lastStmt) return null

    // Skip if last is a raise/return
    if (lastStmt.type === 'raise_statement' || lastStmt.type === 'return_statement') return null

    // If more than 2 stmts in try, the later ones could go in else
    if (stmts.length >= 3) {
      return makeViolation(
        this.ruleKey, tryBody, filePath, 'low',
        'Logic in try body instead of else',
        'Code in `try` body after the risky operation should be in an `else` clause — only guard the risky operation in `try`.',
        sourceCode,
        'Move code that should only run if no exception was raised into the `else` block of the `try` statement.',
      )
    }
    return null
  },
}
