import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { simpleTypeName } from './_helpers.js'

/**
 * C# port of Promise.all-without-error-handling: a fire-and-forget
 * `Task.WhenAll(...)` whose combined task is discarded. Any exception from
 * any of the tasks is silently unobserved.
 *
 * Statement position only: `await Task.WhenAll(…)` propagates exceptions to
 * the caller, assigning the task (`var t = Task.WhenAll(…)`) usually means it
 * is awaited later, and `_ = Task.WhenAll(…)` is the explicit fire-and-forget
 * discard idiom — none of those are flagged. Note that a surrounding
 * try/catch does NOT protect an un-awaited task, so unlike the JS visitor
 * there is no try/catch exemption.
 */
export const csharpPromiseAllNoErrorHandlingVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/promise-all-no-error-handling',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'WhenAll') return null
    if (simpleTypeName(getCSharpReceiver(node)) !== 'Task') return null

    // Only the bare-statement form discards the combined task.
    if (node.parent?.type !== 'expression_statement') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Task.WhenAll without error handling',
      'Task.WhenAll(...) result is discarded — if any task faults, the exception is never observed and the failures vanish silently.',
      sourceCode,
      'await Task.WhenAll(...) (inside a try/catch where recovery is needed) so faulted tasks surface.',
    )
  },
}
