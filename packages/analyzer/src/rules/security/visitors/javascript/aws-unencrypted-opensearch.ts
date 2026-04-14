import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const awsUnencryptedOpenSearchVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/aws-unencrypted-opensearch',
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

    if (ctorName !== 'Domain' && ctorName !== 'CfnDomain') return null

    // Only flag if it looks like an OpenSearch/Elasticsearch domain
    const nodeText = node.text
    if (!/opensearch|elasticsearch|OpenSearch|Elasticsearch/i.test(nodeText) &&
        !/version.*OpenSearch|version.*Elasticsearch/i.test(nodeText)) {
      // Check if the containing variable/call chain hints at OpenSearch
      let parent = node.parent
      let depth = 0
      let foundHint = false
      while (parent && depth < 5) {
        if (/opensearch|elasticsearch/i.test(parent.text)) {
          foundHint = true
          break
        }
        parent = parent.parent
        depth++
      }
      if (!foundHint) return null
    }

    // Flag if encryptionAtRest is explicitly false or absent
    if (/encryptionAtRest\s*:\s*\{[^}]*enabled\s*:\s*false/.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted OpenSearch domain',
        `new ${ctorName}() has encryption at rest disabled. Data at rest is unprotected.`,
        sourceCode,
        'Set encryptionAtRest: { enabled: true } on the OpenSearch Domain construct.',
      )
    }

    // If no encryptionAtRest block is specified, encryption defaults to disabled
    if (!/encryptionAtRest/.test(nodeText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unencrypted OpenSearch domain',
        `new ${ctorName}() does not configure encryptionAtRest. Encryption at rest is disabled by default.`,
        sourceCode,
        'Add encryptionAtRest: { enabled: true } to the OpenSearch Domain construct.',
      )
    }

    return null
  },
}
