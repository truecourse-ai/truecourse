import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsUnencryptedSqsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-sqs',
  languages: ['typescript', 'javascript'],
  nodeTypes: ['new_expression'],
  visit(node, filePath, sourceCode) {
    const ctor = node.childForFieldName('constructor')
    if (!ctor) return null

    let ctorName = ''
    if (ctor.type === 'identifier') {
      ctorName = ctor.text
    } else if (ctor.type === 'member_expression') {
      const prop = ctor.childForFieldName('property')
      if (prop) ctorName = prop.text
    }

    if (ctorName !== 'Queue' && ctorName !== 'CfnQueue') return null

    // Only flag AWS SQS queues — skip BullMQ, bull, and other non-AWS queue libraries
    if (!sourceCode.includes('aws-cdk') && !sourceCode.includes('aws-sqs') && !sourceCode.includes('@aws-sdk')) {
      return null
    }

    const nodeText = node.text
    if (!/encryption\s*:|encryptionMasterKey|kmsKey|kmsMasterKeyId/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted SQS queue',
        `new ${ctorName}() does not configure encryption. SQS messages are unencrypted at rest.`,
        sourceCode,
        'Add encryption: QueueEncryption.KMS_MANAGED or a custom KMS key to the SQS Queue construct.',
      )
    }

    // Also flag if encryption is explicitly set to UNENCRYPTED
    if (/encryption\s*:\s*QueueEncryption\.UNENCRYPTED/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted SQS queue',
        `new ${ctorName}() has encryption: QueueEncryption.UNENCRYPTED. SQS messages are not encrypted.`,
        sourceCode,
        'Use QueueEncryption.KMS_MANAGED or provide a custom KMS key.',
      )
    }

    return null
  },
}
