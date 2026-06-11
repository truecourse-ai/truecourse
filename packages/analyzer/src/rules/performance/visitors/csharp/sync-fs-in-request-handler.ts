import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { isMinimalApiRouteCall } from '../../../_shared/csharp-framework-detection.js'
import { getCSharpChainRoot, isInsideCSharpAsyncContext } from './_helpers.js'

/**
 * C# port of "synchronous I/O in async context": the sync-over-async family.
 * Flags, inside async methods/lambdas (or sync minimal-API route handlers):
 *   - `File.ReadAllText(...)` and friends that have an `...Async` counterpart
 *   - `.Result` on a task-returning call (`client.GetAsync(url).Result`)
 *   - zero-argument `.Wait()` on a member
 *   - `.GetAwaiter().GetResult()`
 *   - `Thread.Sleep(...)`
 * These block a thread-pool thread mid-async-flow and are the classic
 * ASP.NET deadlock/starvation pattern.
 */

// Only File methods with a real async counterpart — File.Exists/Delete/Copy
// have no async version, so there is nothing actionable to suggest.
const SYNC_FILE_METHODS = new Set([
  'ReadAllText', 'ReadAllLines', 'ReadAllBytes',
  'WriteAllText', 'WriteAllLines', 'WriteAllBytes',
  'AppendAllText', 'AppendAllLines',
])

/** Async method or a lambda registered as a minimal-API route handler. */
function isInsideAsyncOrRouteHandler(node: SyntaxNode): boolean {
  if (isInsideCSharpAsyncContext(node)) return true
  let current = node.parent
  while (current) {
    if (current.type === 'lambda_expression' || current.type === 'anonymous_method_expression') {
      let p: SyntaxNode | null = current.parent
      while (p && (p.type === 'argument' || p.type === 'argument_list')) p = p.parent
      if (p?.type === 'invocation_expression' && isMinimalApiRouteCall(p)) return true
    }
    current = current.parent
  }
  return false
}

export const csharpSyncFsInRequestHandlerVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/sync-fs-in-request-handler',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'invocation_expression') {
      const method = getCSharpMethodName(node)
      const receiver = getCSharpReceiver(node).split('.').pop() ?? ''

      if (receiver === 'File' && SYNC_FILE_METHODS.has(method)) {
        if (!isInsideAsyncOrRouteHandler(node)) return null
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Synchronous file I/O in async context',
          `File.${method}() blocks a thread-pool thread on the async path. Use File.${method}Async() with await.`,
          sourceCode,
          `Replace File.${method}(...) with await File.${method}Async(...).`,
        )
      }

      if (receiver === 'Thread' && method === 'Sleep') {
        if (!isInsideAsyncOrRouteHandler(node)) return null
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Thread.Sleep in async context',
          'Thread.Sleep() blocks a thread-pool thread inside async code. Use await Task.Delay() instead.',
          sourceCode,
          'Replace Thread.Sleep(ms) with await Task.Delay(ms).',
        )
      }

      if (method === 'Wait' && getCSharpReceiver(node) !== '' && getCSharpArguments(node).length === 0) {
        if (!isInsideAsyncOrRouteHandler(node)) return null
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Blocking .Wait() in async context',
          '.Wait() blocks the calling thread and risks deadlock inside async code (sync-over-async). Await the task instead.',
          sourceCode,
          'Replace task.Wait() with await task (or semaphore.Wait() with await semaphore.WaitAsync()).',
        )
      }

      if (method === 'GetResult') {
        const fn = node.childForFieldName('function')
        const inner = fn?.type === 'member_access_expression' ? fn.childForFieldName('expression') : null
        if (inner?.type === 'invocation_expression' && getCSharpMethodName(inner) === 'GetAwaiter') {
          if (!isInsideAsyncOrRouteHandler(node)) return null
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Blocking .GetAwaiter().GetResult() in async context',
            '.GetAwaiter().GetResult() blocks the calling thread inside async code (sync-over-async). Await the task instead.',
            sourceCode,
            'Replace task.GetAwaiter().GetResult() with await task.',
          )
        }
      }

      return null
    }

    // member_access_expression: `.Result` on a task-returning expression.
    const name = node.childForFieldName('name')
    if (name?.text !== 'Result') return null
    const receiver = node.childForFieldName('expression')
    if (receiver?.type !== 'invocation_expression') return null
    const receiverMethod = getCSharpMethodName(receiver)
    const root = getCSharpChainRoot(receiver)
    const taskLike = receiverMethod.endsWith('Async') || (root.type === 'identifier' && root.text === 'Task')
    if (!taskLike) return null
    if (!isInsideAsyncOrRouteHandler(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Blocking .Result in async context',
      `.Result on ${receiverMethod}() blocks the calling thread and risks deadlock inside async code (sync-over-async). Await the call instead.`,
      sourceCode,
      `Replace ${receiverMethod}(...).Result with await ${receiverMethod}(...).`,
    )
  },
}
