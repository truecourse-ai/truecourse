import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonYieldFromInAsyncVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/yield-from-in-async',
  languages: ['python'],
  nodeTypes: ['yield'],
  visit(node, filePath, sourceCode) {
    // Check if this is `yield from ...`
    const hasFrom = node.children.some((c) => c.text === 'from')
    if (!hasFrom) return null

    // Check if we're inside an async function
    let current = node.parent
    while (current) {
      if (current.type === 'function_definition') {
        const isAsync = current.children.some((c) => c.text === 'async')
        if (isAsync) {
          return makeViolation(
            this.ruleKey, node, filePath, 'critical',
            'yield from in async function',
            '`yield from` inside an async function is a SyntaxError in Python — use `async for` to iterate asynchronously.',
            sourceCode,
            'Replace `yield from iterable` with `async for item in iterable: yield item`.',
          )
        }
        break // stop at function boundary
      }
      current = current.parent
    }
    return null
  },
}
