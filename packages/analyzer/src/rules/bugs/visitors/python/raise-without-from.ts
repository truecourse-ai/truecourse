import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonRaiseWithoutFromVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/raise-without-from-in-except',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    for (const stmt of body.namedChildren) {
      if (stmt.type === 'raise_statement') {
        const raisedChildren = stmt.namedChildren
        // A raise with a value but no `from` clause
        if (raisedChildren.length > 0) {
          // Check there's no `from` keyword
          const hasFrom = stmt.children.some((c) => c.text === 'from')
          if (!hasFrom) {
            return makeViolation(
              this.ruleKey, stmt, filePath, 'medium',
              'Raise without from in except',
              'Raising a new exception inside an `except` block without `from` hides the original error context. Use `raise NewException() from e` to preserve the traceback.',
              sourceCode,
              'Add `from e` (or `from None` to suppress the original) to the raise statement.',
            )
          }
        }
      }
    }

    return null
  },
}
