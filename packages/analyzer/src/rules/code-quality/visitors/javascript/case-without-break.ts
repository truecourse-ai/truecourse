import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const caseWithoutBreakVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/case-without-break',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['switch_case'],
  visit(node, filePath, sourceCode) {
    const valueNode = node.childForFieldName('value')
    const stmts = node.namedChildren.filter((c) => c !== valueNode)

    if (stmts.length === 0) return null

    let last = stmts[stmts.length - 1]
    // If the last statement is a block, check the last statement inside the block
    if (last.type === 'statement_block') {
      const blockStmts = last.namedChildren
      if (blockStmts.length > 0) last = blockStmts[blockStmts.length - 1]
    }
    if (last.type === 'break_statement' || last.type === 'return_statement'
      || last.type === 'throw_statement' || last.type === 'continue_statement') {
      return null
    }

    const nodeText = node.text
    if (/fallthrough|falls?\s*through|fall-through/i.test(nodeText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Switch case without break',
      'Switch case falls through to the next case — add a `break`, `return`, or `throw`, or mark intentional fallthrough with a comment.',
      sourceCode,
      'Add `break;` at the end of the case, or add a `// fallthrough` comment if intentional.',
    )
  },
}
