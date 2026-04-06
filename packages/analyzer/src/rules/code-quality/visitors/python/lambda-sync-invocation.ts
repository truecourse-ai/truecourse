import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects Lambda functions synchronously invoking other Lambda functions
 * via boto3 lambda.invoke() with InvocationType='RequestResponse'.
 */
export const pythonLambdaSyncInvocationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/lambda-sync-invocation',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'invoke') return null

    // Check for InvocationType='RequestResponse'
    const args = node.childForFieldName('arguments')
    if (!args) return null

    const kwargs = args.namedChildren.filter((c) => c.type === 'keyword_argument')
    const invocationTypeArg = kwargs.find((c) => c.childForFieldName('name')?.text === 'InvocationType')
    if (!invocationTypeArg) return null

    const value = invocationTypeArg.childForFieldName('value')
    if (!value) return null
    const valueText = value.text

    if (!valueText.includes('RequestResponse')) return null

    // Verify it looks like a lambda client call
    const obj = fn.childForFieldName('object')
    const objText = obj?.text ?? ''
    if (!objText.includes('lambda') && !objText.includes('Lambda')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Lambda synchronously invoking Lambda',
      'Synchronous Lambda invocation (`InvocationType=\'RequestResponse\'`) blocks the caller — use `Event` (async) invocation or AWS Step Functions for orchestration.',
      sourceCode,
      'Change to `InvocationType=\'Event\'` for async invocation or use AWS Step Functions.',
    )
  },
}
