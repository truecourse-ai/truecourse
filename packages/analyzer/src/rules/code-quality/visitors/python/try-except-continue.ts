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

    // Skip when the body has a sibling explanatory comment in the
    // raw text. The comment is the intentional-skip signal —
    // typical for best-effort scans over external resources.
    {
      const lines = sourceCode.split('\n')
      const startRow = body.startPosition.row
      const endRow = body.endPosition.row
      for (let r = startRow; r <= endRow; r++) {
        const line = lines[r] ?? ''
        if (/^\s*#/.test(line)) return null
      }
    }

    // A typed exception narrows the suppression to one specific recoverable
    // error - `except TimeoutError: continue` is the canonical Python idiom
    // for "drop this iteration when this specific thing fails." Only fire
    // for bare except / `Exception` / `BaseException`, where the writer is
    // silently swallowing every error including programming bugs.
    const exprChildren = node.namedChildren.filter(
      (c) => c.type !== 'block' && c.type !== 'comment',
    )
    if (exprChildren.length > 0) {
      const exceptionType = exprChildren[0]
      const typeText = exceptionType.type === 'as_pattern'
        ? exceptionType.namedChildren[0]?.text
        : exceptionType.text
      if (typeText && typeText !== 'Exception' && typeText !== 'BaseException') {
        return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Silent exception with continue',
      '`except` block with only `continue` silently ignores errors in loops.',
      sourceCode,
      'Add logging or error handling before `continue`, or use `contextlib.suppress()` for intentional suppression.',
    )
  },
}
