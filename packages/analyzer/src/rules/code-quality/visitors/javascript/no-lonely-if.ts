import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const noLonelyIfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-lonely-if',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['else_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren[0]
    if (!body || body.type !== 'statement_block') return null

    const stmts = body.namedChildren
    if (stmts.length !== 1 || stmts[0].type !== 'if_statement') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Lonely if in else block',
      '`if` is the only statement inside `else {}`. Use `else if` instead.',
      sourceCode,
      'Replace `else { if (...) }` with `else if (...)`.',
    )
  },
}
