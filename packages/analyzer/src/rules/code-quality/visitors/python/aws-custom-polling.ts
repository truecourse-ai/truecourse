import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsPythonCallTo, containsPythonIdentifierExact } from '../../../_shared/python-helpers.js'
import { importsAwsSdk } from '../../../_shared/python-framework-detection.js'

/**
 * Detects custom polling loops with boto3 describe_* or get_* calls
 * instead of using AWS waiters.
 */
export const pythonAwsCustomPollingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/aws-custom-polling',
  languages: ['python'],
  nodeTypes: ['while_statement'],
  visit(node, filePath, sourceCode) {
    // Only flag files that actually import an AWS SDK (boto3/botocore/aiobotocore)
    if (!importsAwsSdk(node)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const bodyText = body.text

    // Check for boto3 describe_/get_ calls inside the loop
    const hasDescribeCall = /describe_[a-z_]+\(|get_[a-z_]+\(/.test(bodyText)
    if (!hasDescribeCall) return null

    // Check for sleep call (indicates polling)
    const hasSleep = containsPythonCallTo(body, 'time.sleep') || containsPythonCallTo(body, 'sleep')
    if (!hasSleep) return null

    // Check for status/state check
    const hasStatusCheck = containsPythonIdentifierExact(body, 'status') || containsPythonIdentifierExact(body, 'state') || containsPythonIdentifierExact(body, 'Status') || containsPythonIdentifierExact(body, 'State')
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
