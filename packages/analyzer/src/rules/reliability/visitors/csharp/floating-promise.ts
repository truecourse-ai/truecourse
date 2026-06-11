import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { simpleTypeName } from './_helpers.js'

/**
 * Floating Task — the C# analog of a floating promise, ported as a
 * high-precision PARTIAL rule (no type checker): a statement-position
 * invocation that is un-awaited where the method either follows the
 * Task-returning `…Async` naming convention or is a known Task-returning
 * BCL call. Exceptions from such tasks are never observed.
 *
 * Naturally skipped by the statement-position restriction:
 *   - `await Foo Async()` (statement child is an await_expression),
 *   - `_ = FooAsync()` — the explicit fire-and-forget discard idiom,
 *   - `var t = FooAsync()` (awaited later),
 *   - `FooAsync().ConfigureAwait/ContinueWith/Wait/GetAwaiter()…` (outermost
 *     method name no longer ends in Async — conservatively out of scope),
 *   - returned / lambda-expression-bodied tasks.
 *
 * `Task.WhenAll` is deliberately excluded — the promise-all-no-error-handling
 * port owns that exact construct.
 */
const TASK_FACTORY_METHODS = new Set(['Run', 'Delay', 'WhenAny'])

export const csharpFloatingPromiseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/floating-promise',
  languages: ['csharp'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'invocation_expression') return null

    const method = getCSharpMethodName(expr)
    const receiver = simpleTypeName(getCSharpReceiver(expr))

    const isAsyncByConvention = method.length > 'Async'.length && method.endsWith('Async')
    const isTaskFactory = receiver === 'Task' && TASK_FACTORY_METHODS.has(method)
    if (!isAsyncByConvention && !isTaskFactory) return null

    const display = receiver ? `${receiver}.${method}` : method
    return makeViolation(
      this.ruleKey, expr, filePath, 'high',
      'Floating task',
      `${display}() returns a Task that is never awaited. The call may not complete before the scope exits, and any exception it throws is silently lost.`,
      sourceCode,
      'await the call (or assign it and await later). For intentional fire-and-forget, use the `_ = …` discard with explicit error handling inside the task.',
    )
  },
}
