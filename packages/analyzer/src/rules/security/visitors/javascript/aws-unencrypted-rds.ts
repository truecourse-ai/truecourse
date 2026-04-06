import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsUnencryptedRdsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-rds',
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

    if (ctorName !== 'DatabaseInstance' && ctorName !== 'CfnDBInstance' &&
        ctorName !== 'DatabaseCluster' && ctorName !== 'CfnDBCluster') return null

    const nodeText = node.text
    if (/storageEncrypted\s*:\s*false/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted RDS database',
        `new ${ctorName}() has storage encryption disabled. Data at rest is unprotected.`,
        sourceCode,
        'Set storageEncrypted: true on the RDS DatabaseInstance construct.',
      )
    }

    if (!/storageEncrypted/.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted RDS database',
        `new ${ctorName}() does not set storageEncrypted. RDS storage encryption is disabled by default.`,
        sourceCode,
        'Add storageEncrypted: true to the RDS DatabaseInstance construct.',
      )
    }

    return null
  },
}
