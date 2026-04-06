import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsUnencryptedSqsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-sqs-python',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    } else if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) funcName = attr.text
    }

    if (funcName !== 'Queue' && funcName !== 'CfnQueue') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    let hasEncryption = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        if (name?.text === 'encryption' || name?.text === 'kms_master_key_id' ||
            name?.text === 'kms_key') {
          hasEncryption = true
        }
      }
    }

    if (!hasEncryption) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted SQS queue',
        `${funcName}() created without encryption. Queue messages are not encrypted at rest.`,
        sourceCode,
        'Provide an encryption key to enable SQS server-side encryption.',
      )
    }

    return null
  },
}
