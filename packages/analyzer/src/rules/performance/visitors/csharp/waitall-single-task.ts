import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpReceiverSimpleName } from './_helpers.js'

/**
 * `Task.WaitAll(SingleTask())` blocks the calling thread to wait on a single
 * task through the array-based combinator. The receiver simple name must be
 * `Task` with exactly one task-producing argument (a call or awaited value);
 * a bare identifier or array argument is left alone since it may be a
 * `Task[]`.
 */
const SINGLE_TASK_ARG_TYPES = new Set(['invocation_expression', 'await_expression'])

export const csharpWaitAllSingleTaskVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/waitall-single-task',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'WaitAll') return null
    if (getCSharpReceiverSimpleName(node) !== 'Task') return null

    const args = getCSharpArguments(node)
    if (args.length !== 1) return null
    if (!SINGLE_TASK_ARG_TYPES.has(args[0]!.type)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'WaitAll with a single task',
      'Task.WaitAll with one task routes a single wait through the array-based combinator, adding overhead where the task can be awaited (or waited on) directly.',
      sourceCode,
      'Wait on or await the single task directly instead of wrapping it in Task.WaitAll.',
    )
  },
}
