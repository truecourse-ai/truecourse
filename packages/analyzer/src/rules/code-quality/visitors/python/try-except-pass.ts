import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonTryExceptPassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/try-except-pass',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    const stmts = body.namedChildren
    if (stmts.length !== 1) return null
    if (stmts[0].type !== 'pass_statement') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Silent exception with pass',
      '`except` block with only `pass` silently swallows all errors — use `contextlib.suppress()` or add error handling.',
      sourceCode,
      'Replace with `contextlib.suppress(ExceptionType)` or add proper error handling.',
    )
  },
}
