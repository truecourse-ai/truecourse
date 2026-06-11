import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCSharpEnclosingTestMethod } from './_helpers.js'

export const csharpTestWithHardcodedTimeoutVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-with-hardcoded-timeout',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = getCSharpReceiver(node)
    const method = getCSharpMethodName(node)

    const isSleep = (receiver === 'Thread' && method === 'Sleep')
      || (receiver === 'Task' && method === 'Delay')
    if (!isSleep) return null

    if (!getCSharpEnclosingTestMethod(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Hardcoded timeout in test',
      `\`${receiver}.${method}()\` in a test is fragile and slow — the test either wastes time or fails on slow machines.`,
      sourceCode,
      'Replace the sleep with deterministic synchronization (await the operation, TaskCompletionSource, or a polling helper with a deadline).',
    )
  },
}
