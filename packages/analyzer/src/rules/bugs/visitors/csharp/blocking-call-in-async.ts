import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { isAsyncNamedInvocation, isInsideAsyncFunction } from './_helpers.js'

/**
 * Synchronous blocking inside an async method — ties up the thread and can
 * deadlock (sync-over-async):
 *   - `Thread.Sleep(…)` (use `await Task.Delay`)
 *   - `Task.WaitAll/WaitAny(…)` (use `await Task.WhenAll/WhenAny`)
 *   - `FooAsync().Result` / `.Wait()` / `.GetAwaiter().GetResult()` directly
 *     chained on a Task-returning call
 *
 * `task.Result` on a plain variable is NOT flagged — after
 * `Task.WhenAll(tasks)` reading `tasks[i].Result` is the correct idiom.
 */
function blockedTaskCall(n: SyntaxNode): string | null {
  // <…>Async(...).Result
  if (n.type === 'member_access_expression') {
    const name = n.childForFieldName('name')?.text
    const target = n.childForFieldName('expression')
    if (name === 'Result' && target && isAsyncNamedInvocation(target)) return `${getCSharpMethodName(target)}().Result`
    return null
  }
  // <…>Async(...).Wait() / <…>Async(...).GetAwaiter().GetResult()
  if (n.type === 'invocation_expression') {
    const method = getCSharpMethodName(n)
    if (method !== 'Wait' && method !== 'GetAwaiter') return null
    const fn = n.childForFieldName('function')
    const target = fn?.type === 'member_access_expression' ? fn.childForFieldName('expression') : null
    if (target && isAsyncNamedInvocation(target)) {
      return `${getCSharpMethodName(target)}().${method === 'Wait' ? 'Wait()' : 'GetAwaiter().GetResult()'}`
    }
  }
  return null
}

export const csharpBlockingCallInAsyncVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/blocking-call-in-async',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'member_access_expression'],
  visit(node, filePath, sourceCode) {
    // Only the outermost node of a chain should report (avoid double-firing
    // on `FooAsync().Wait()` for both the invocation and its member access).
    if (node.type === 'member_access_expression' && node.parent?.type === 'invocation_expression') return null

    let blocked: string | null = null
    let fix = ''
    if (node.type === 'invocation_expression') {
      const method = getCSharpMethodName(node)
      const receiver = getCSharpReceiver(node).split('.').pop()
      if (receiver === 'Thread' && method === 'Sleep') {
        blocked = 'Thread.Sleep'
        fix = 'Use `await Task.Delay(...)` instead of Thread.Sleep.'
      } else if (receiver === 'Task' && (method === 'WaitAll' || method === 'WaitAny')) {
        blocked = `Task.${method}`
        fix = `Use \`await Task.${method === 'WaitAll' ? 'WhenAll' : 'WhenAny'}(...)\` instead.`
      }
    }
    if (!blocked) {
      blocked = blockedTaskCall(node)
      if (blocked) fix = 'Await the call instead: `await FooAsync(...)`.'
    }
    if (!blocked) return null

    if (!isInsideAsyncFunction(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Blocking call in async method',
      `\`${blocked}\` blocks the thread inside an async method — it defeats the purpose of async and can deadlock under a synchronization context.`,
      sourceCode,
      fix,
    )
  },
}
