import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver, getCSharpArguments } from '../../../_shared/csharp-helpers.js'

/**
 * `Debug.Assert(false)` is an always-failing assertion used to mark a path the
 * author believes is unreachable. `Debug.Fail(...)` expresses that intent
 * directly — it takes a message rather than a redundant `false` condition and
 * reads unmistakably as "this should never run".
 */
export const csharpDebugAssertFalseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/debug-assert-false',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Assert') return null
    const receiver = getCSharpReceiver(node)
    if (receiver !== 'Debug' && !receiver.endsWith('.Debug')) return null

    const args = getCSharpArguments(node)
    const first = args[0]
    if (!first || first.type !== 'boolean_literal' || first.text !== 'false') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use Debug.Fail instead of Debug.Assert(false)',
      '`Debug.Assert(false)` is an always-failing assertion marking an unreachable path; `Debug.Fail(message)` states that intent directly.',
      sourceCode,
      'Replace `Debug.Assert(false, ...)` with `Debug.Fail(...)`.',
    )
  },
}
