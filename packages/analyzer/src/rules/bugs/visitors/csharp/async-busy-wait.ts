import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { CSHARP_FUNCTION_BOUNDARIES, isInsideAsyncFunction } from './_helpers.js'

/**
 * A polling loop inside an async method that sleeps without yielding:
 * `while (!ready) { Thread.Sleep(100); }` or an un-awaited `Task.Delay(…);`.
 * Properly awaited `await Task.Delay(…)` polling is NOT flagged — it yields
 * the thread (use of an event/semaphore is still nicer, but it isn't a bug).
 */
function isSleepCall(n: SyntaxNode): boolean {
  if (n.type !== 'invocation_expression') return false
  const method = getCSharpMethodName(n)
  const receiver = getCSharpReceiver(n).split('.').pop()
  return (receiver === 'Thread' && method === 'Sleep') || (receiver === 'Task' && method === 'Delay')
}

function findUnyieldedSleep(n: SyntaxNode): SyntaxNode | null {
  if (isSleepCall(n) && n.parent?.type !== 'await_expression') return n
  if (CSHARP_FUNCTION_BOUNDARIES.has(n.type)) return null
  for (let i = 0; i < n.namedChildCount; i++) {
    const child = n.namedChild(i)
    if (child) {
      const found = findUnyieldedSleep(child)
      if (found) return found
    }
  }
  return null
}

export const csharpAsyncBusyWaitVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/async-busy-wait',
  languages: ['csharp'],
  nodeTypes: ['while_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    if (!isInsideAsyncFunction(node)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const sleep = findUnyieldedSleep(body)
    if (!sleep) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Async busy-wait loop',
      `This loop polls with a blocking \`${getCSharpReceiver(sleep)}.${getCSharpMethodName(sleep)}(...)\` inside an async method — it holds the thread instead of yielding.`,
      sourceCode,
      'Use `await Task.Delay(...)` to yield while polling, or better, wait on a SemaphoreSlim/TaskCompletionSource signal.',
    )
  },
}
