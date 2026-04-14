import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwaitOutsideAsyncVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/await-outside-async',
  languages: ['python'],
  nodeTypes: ['await'],
  visit(node, filePath, sourceCode) {
    // Walk up and check if we are inside an async function
    let current = node.parent
    while (current) {
      if (current.type === 'function_definition') {
        // Check if it has async keyword
        const isAsync = current.children.some((c) => c.type === 'async' || c.text === 'async')
        if (isAsync) return null // inside async — fine
        // Inside a non-async function — flag it
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'await outside async function',
          '`await` is used inside a non-async function — this is a SyntaxError.',
          sourceCode,
          'Add `async` to the function definition: `async def ...`.',
        )
      }
      current = current.parent
    }

    // Top-level await — flag it (only valid in REPL/notebooks, not in modules)
    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      'await outside async function',
      '`await` at the module/top level is only valid in interactive Python sessions.',
      sourceCode,
      'Move the await inside an async function.',
    )
  },
}
