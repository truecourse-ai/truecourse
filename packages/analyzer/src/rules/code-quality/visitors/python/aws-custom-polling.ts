import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects custom polling loops with boto3 describe_* or get_* calls
 * instead of using AWS waiters.
 */
export const pythonAwsCustomPollingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/aws-custom-polling',
  languages: ['python'],
  nodeTypes: ['while_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const bodyText = body.text

    // Check for boto3 describe_/get_ calls inside the loop
    const hasDescribeCall = /describe_[a-z_]+\(|get_[a-z_]+\(/.test(bodyText)
    if (!hasDescribeCall) return null

    // Check for sleep call (indicates polling)
    const hasSleep = bodyText.includes('time.sleep') || bodyText.includes('sleep(')
    if (!hasSleep) return null

    // Check for status/state check
    const hasStatusCheck = bodyText.includes('status') || bodyText.includes('state') || bodyText.includes('State') || bodyText.includes('Status')
    if (!hasStatusCheck) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Custom polling loop instead of AWS waiter',
      'Custom polling loop with boto3 `describe_*` calls and `time.sleep()` — use AWS waiters (`client.get_waiter("...")`) which handle retries, timeouts, and backoff properly.',
      sourceCode,
      'Replace with `client.get_waiter("...").wait(...)` for the appropriate waiter.',
    )
  },
}
