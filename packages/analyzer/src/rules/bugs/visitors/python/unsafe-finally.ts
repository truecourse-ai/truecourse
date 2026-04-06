import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnsafeFinallyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-finally',
  languages: ['python'],
  nodeTypes: ['finally_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    for (const child of body.namedChildren) {
      if (child.type === 'return_statement') {
        return makeViolation(
          this.ruleKey, child, filePath, 'high',
          'Unsafe finally',
          '`return` in a `finally` block silently discards any value returned or exception raised by `try` or `except`.',
          sourceCode,
          'Remove the return from the finally block or restructure the control flow.',
        )
      }
      if (child.type === 'raise_statement') {
        return makeViolation(
          this.ruleKey, child, filePath, 'high',
          'Unsafe finally',
          '`raise` in a `finally` block silently discards any value returned or exception raised by `try` or `except`.',
          sourceCode,
          'Remove the raise from the finally block or restructure the control flow.',
        )
      }
    }
    return null
  },
}
