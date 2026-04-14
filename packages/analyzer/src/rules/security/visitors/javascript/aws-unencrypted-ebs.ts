import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsUnencryptedEbsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-ebs',
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

    if (ctorName !== 'Volume' && ctorName !== 'CfnVolume') return null

    const nodeText = node.text
    // Flag if encrypted: false or encrypted is absent
    if (/encrypted\s*:\s*false/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted EBS volume',
        `new ${ctorName}() created with encrypted: false. Data at rest is unprotected.`,
        sourceCode,
        'Set encrypted: true to enable EBS volume encryption.',
      )
    }

    return null
  },
}
