import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

/**
 * `Task.Factory.StartNew(...)` and `task.ContinueWith(...)` without an explicit
 * TaskScheduler default to `TaskScheduler.Current`, not `TaskScheduler.Default`.
 * Inside a task that itself runs on a non-default scheduler, the continuation
 * then inherits that scheduler — a frequent source of UI-thread surprises and
 * unintended serialization. Passing the scheduler explicitly removes the
 * ambiguity.
 *
 * Precision:
 *   - StartNew is only flagged on a `*.Factory` receiver (TaskFactory), not
 *     unrelated StartNew methods;
 *   - we skip when any argument names a TaskScheduler (TaskScheduler.Default,
 *     a `scheduler` argument, `uiScheduler`, etc.).
 */
function argsMentionScheduler(node: ReturnType<typeof getCSharpArguments>): boolean {
  return node.some((a) => /scheduler/i.test(a.text))
}

export const csharpTaskWithoutTaskSchedulerVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/task-without-taskscheduler',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (method !== 'StartNew' && method !== 'ContinueWith') return null

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null

    const receiver = getCSharpReceiver(node)
    if (method === 'StartNew' && !receiver.endsWith('Factory')) return null

    const args = getCSharpArguments(node)
    if (args.length === 0) return null
    if (argsMentionScheduler(args)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `${method} without an explicit TaskScheduler`,
      `${method}() with no TaskScheduler argument defaults to TaskScheduler.Current, not TaskScheduler.Default. Inside a task already running on a non-default scheduler the continuation inherits it, which can serialize work onto an unexpected (e.g. UI) thread.`,
      sourceCode,
      'Pass TaskScheduler.Default explicitly, or prefer Task.Run / await over Task.Factory.StartNew + ContinueWith.',
    )
  },
}
