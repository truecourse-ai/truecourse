import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsUnencryptedSnsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-sns-python',
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

    if (funcName !== 'Topic' && funcName !== 'CfnTopic') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    let hasMasterKey = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        if (name?.text === 'master_key' || name?.text === 'kms_master_key_id') {
          hasMasterKey = true
        }
      }
    }

    if (!hasMasterKey) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted SNS topic',
        `${funcName}() created without a KMS master key. Messages are not encrypted at rest.`,
        sourceCode,
        'Provide a master_key to enable SNS encryption.',
      )
    }

    return null
  },
}
