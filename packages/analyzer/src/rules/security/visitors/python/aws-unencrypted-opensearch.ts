import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAwsUnencryptedOpenSearchVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-opensearch-python',
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

    if (funcName !== 'Domain' && funcName !== 'CfnDomain') return null

    // Look for encryption_at_rest or EncryptionAtRestOptions with enabled=False
    const nodeText = node.text
    if (/encryption_at_rest.*enabled.*False|EncryptionAtRestOptions.*Enabled.*False/i.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted OpenSearch domain',
        `${funcName}() configured with encryption at rest disabled.`,
        sourceCode,
        'Enable encryption at rest for the OpenSearch domain.',
      )
    }

    return null
  },
}
