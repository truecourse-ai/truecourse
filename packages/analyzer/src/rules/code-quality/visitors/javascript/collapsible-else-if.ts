import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const collapsibleElseIfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/collapsible-else-if',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['else_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren[0]
    if (!body) return null

    if (body.type === 'statement_block') {
      const stmts = body.namedChildren
      if (stmts.length === 1 && stmts[0].type === 'if_statement') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Collapsible else-if',
          '`else { if (...) }` should be written as `else if (...)` to reduce nesting.',
          sourceCode,
          'Replace `else { if (...) { ... } }` with `else if (...) { ... }`.',
        )
      }
    }
    return null
  },
}
