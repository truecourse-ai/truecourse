import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryElseAfterReturnVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-else-after-return',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const elseClause = node.children.find((c) => c.type === 'else_clause')
    if (!consequence || !elseClause) return null
    if (consequence.type !== 'block') return null

    // Skip elif chains
    const elifClause = node.children.find((c) => c.type === 'elif_clause')
    if (elifClause) return null

    // Check if consequence ends with return
    const stmts = consequence.namedChildren
    if (stmts.length === 0) return null
    const lastStmt = stmts[stmts.length - 1]
    if (lastStmt.type !== 'return_statement') return null

    // Skip redundant boolean patterns (let another rule handle if applicable)
    // Just flag the general pattern
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary else after return',
      'The else block is unnecessary because the if branch returns. Move the else body to the outer scope.',
      sourceCode,
      'Remove the else wrapper — the code after the if block will only run when the condition is false.',
    )
  },
}
