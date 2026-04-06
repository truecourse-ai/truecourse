import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_AWS_KEY_PATTERN = /^AKIA[0-9A-Z]{16}$/

export const pythonLongTermAwsKeysInCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/long-term-aws-keys-in-code',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const val = node.text.replace(/^[rRbBuU]*['"`]{1,3}|['"`]{1,3}$/g, '')

    if (PYTHON_AWS_KEY_PATTERN.test(val)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'AWS access key hardcoded',
        `Hardcoded AWS access key ID detected: "${val}". Use IAM roles or environment variables.`,
        sourceCode,
        'Remove the hardcoded key and use boto3 credential chain (env vars, IAM role, etc.).',
      )
    }

    return null
  },
}
