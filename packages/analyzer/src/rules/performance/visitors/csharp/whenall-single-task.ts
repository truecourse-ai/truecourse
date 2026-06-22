import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName } from './_helpers.js'

/**
 * `Task.WhenAll(SingleTask())` builds an array, allocates a combined task and
 * schedules a continuation to await one task that could be awaited directly.
 * The receiver simple name must be `Task` and there must be exactly one
 * argument that is itself a task-producing expression (a call or awaited
 * value) — a bare identifier or array argument is left alone, since it may be
 * a `Task[]`/`IEnumerable<Task>` rather than a single task.
 */
const SINGLE_TASK_ARG_TYPES = new Set(['invocation_expression', 'await_expression'])

export const csharpWhenAllSingleTaskVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/whenall-single-task',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'WhenAll') return null
    if (getCSharpReceiverSimpleName(node) !== 'Task') return null

    const args = getCSharpArguments(node)
    if (args.length !== 1) return null
    if (!SINGLE_TASK_ARG_TYPES.has(args[0]!.type)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'WhenAll with a single task',
      'Task.WhenAll with one task allocates an array and a combined task to await a single task that can be awaited directly.',
      sourceCode,
      'Await the single task directly instead of wrapping it in Task.WhenAll.',
    )
  },
}
