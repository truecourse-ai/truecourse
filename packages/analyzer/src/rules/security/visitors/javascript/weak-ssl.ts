import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const WEAK_TLS_PROTOCOLS = new Set([
  'sslv2_method', 'sslv3_method', 'sslv23_method',
  'tlsv1_method', 'tlsv1_0_method',
  'sslv2', 'sslv3', 'tlsv1', 'tlsv1.0',
])

export const weakSslVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-ssl',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    if (key?.text === 'secureProtocol' && value) {
      const protocol = value.text.replace(/['"]/g, '').toLowerCase()
      if (WEAK_TLS_PROTOCOLS.has(protocol)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Weak SSL/TLS protocol',
          `Using deprecated protocol "${value.text.replace(/['"]/g, '')}". SSLv2, SSLv3, and TLS 1.0 are insecure.`,
          sourceCode,
          'Use TLS 1.2 or TLS 1.3 (e.g., TLS_method with minVersion set to TLSv1.2).',
        )
      }
    }

    if (key?.text === 'minVersion' && value) {
      const version = value.text.replace(/['"]/g, '').toLowerCase()
      if (version === 'tlsv1' || version === 'tlsv1.0') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Weak SSL/TLS protocol',
          'Setting minimum TLS version to 1.0 allows insecure connections.',
          sourceCode,
          'Set minVersion to "TLSv1.2" or higher.',
        )
      }
    }

    return null
  },
}
