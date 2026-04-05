import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const AWS_KEY_PATTERN = /^AKIA[0-9A-Z]{16}$/
const AWS_SECRET_NAMES = new Set(['aws_secret_access_key', 'aws_secret_key', 'secretaccesskey', 'awssecret'])

export const longTermAwsKeysInCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/long-term-aws-keys-in-code',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const val = node.text.replace(/['"]/g, '')

    if (AWS_KEY_PATTERN.test(val)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        'AWS access key hardcoded',
        `Hardcoded AWS access key ID detected: "${val}". Use IAM roles or environment variables instead.`,
        sourceCode,
        'Remove the hardcoded key and use AWS_ACCESS_KEY_ID from environment variables or an IAM role.',
      )
    }

    // Check for secret key assignment
    const parent = node.parent
    if (parent) {
      const keyNode = parent.childForFieldName('key') ?? parent.childForFieldName('name')
      if (keyNode) {
        const keyName = keyNode.text.toLowerCase().replace(/['"]/g, '')
        if (AWS_SECRET_NAMES.has(keyName) && val.length >= 20) {
          return makeViolation(
            this.ruleKey, node, filePath, 'critical',
            'AWS secret access key hardcoded',
            `AWS secret key assigned to "${keyNode.text}" as a hardcoded string.`,
            sourceCode,
            'Use environment variables (AWS_SECRET_ACCESS_KEY) or an IAM role.',
          )
        }
      }
    }

    return null
  },
}
