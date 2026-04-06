import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsUnencryptedSnsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-sns',
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

    if (ctorName !== 'Topic' && ctorName !== 'CfnTopic') return null

    const nodeText = node.text
    if (!/masterKey|kmsMasterKeyId|kmsKey/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted SNS topic',
        `new ${ctorName}() does not configure a KMS master key. SNS messages are unencrypted at rest.`,
        sourceCode,
        'Add masterKey to the SNS Topic construct to enable server-side encryption.',
      )
    }

    return null
  },
}
