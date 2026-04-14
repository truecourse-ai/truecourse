import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonTryExceptContinueVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/try-except-continue',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    const stmts = body.namedChildren
    if (stmts.length !== 1) return null
    if (stmts[0].type !== 'continue_statement') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Silent exception with continue',
      '`except` block with only `continue` silently ignores errors in loops.',
      sourceCode,
      'Add logging or error handling before `continue`, or use `contextlib.suppress()` for intentional suppression.',
    )
  },
}
