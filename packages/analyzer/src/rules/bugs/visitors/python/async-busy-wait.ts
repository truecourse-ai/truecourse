import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects sleep() calls in while loops inside async functions.
 * This is a busy-wait pattern that should use events or conditions instead.
 */
export const pythonAsyncBusyWaitVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/async-busy-wait',
  languages: ['python'],
  nodeTypes: ['while_statement'],
  visit(node, filePath, sourceCode) {
    // Check if we're inside an async function
    let parent = node.parent
    while (parent) {
      if (parent.type === 'function_definition') {
        const isAsync = parent.children.some((c) => c.type === 'async' || c.text === 'async')
        if (!isAsync) return null
        break
      }
      parent = parent.parent
    }
    if (!parent) return null

    // Look for sleep() call in the while body
    const body = node.childForFieldName('body')
    if (!body) return null

    function hasSleepCall(n: import('tree-sitter').SyntaxNode): boolean {
      if (n.type === 'call') {
        const func = n.childForFieldName('function')
        if (!func) return false
        // asyncio.sleep, trio.sleep, anyio.sleep, time.sleep, await asyncio.sleep
        const text = func.text
        if (
          text === 'asyncio.sleep' || text === 'trio.sleep' ||
          text === 'anyio.sleep' || text === 'time.sleep' || text === 'sleep'
        ) return true
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasSleepCall(child)) return true
      }
      return false
    }

    /**
     * Check if the loop body contains `await sleep(...)` — this means the
     * loop properly yields control and is NOT a busy wait.
     */
    function hasAwaitedSleep(n: import('tree-sitter').SyntaxNode): boolean {
      if (n.type === 'await' || n.type === 'await_expression') {
        // The awaited expression should be a sleep call
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child && hasSleepCall(child)) return true
        }
      }
      // Don't recurse into nested function definitions
      if (n.type === 'function_definition') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasAwaitedSleep(child)) return true
      }
      return false
    }

    // If the sleep is properly awaited, this is not a busy wait
    if (hasAwaitedSleep(body)) return null

    if (hasSleepCall(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Async busy wait loop',
        'Using `sleep()` in a while loop instead of events or conditions — this is a busy-wait pattern that wastes CPU cycles and should use proper async synchronization primitives.',
        sourceCode,
        'Replace the busy-wait loop with `asyncio.Event`, `asyncio.Condition`, or a similar async synchronization primitive.',
      )
    }

    return null
  },
}
