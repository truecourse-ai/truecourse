import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const sslVersionUnsafeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/ssl-version-unsafe',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['pair'],
  visit(node, filePath, sourceCode) {
    const key = node.childForFieldName('key')
    const value = node.childForFieldName('value')

    if (key?.text === 'minVersion' && value) {
      const version = value.text.replace(/['"]/g, '').toLowerCase()
      if (version === 'tlsv1' || version === 'tlsv1.0' || version === 'tlsv1.1') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unsafe SSL/TLS minimum version',
          `Minimum TLS version set to "${value.text.replace(/['"]/g, '')}". TLS 1.0 and 1.1 are deprecated.`,
          sourceCode,
          'Set minVersion to "TLSv1.2" or higher.',
        )
      }
    }

    if (key?.text === 'maxVersion' && value) {
      const version = value.text.replace(/['"]/g, '').toLowerCase()
      if (version === 'tlsv1' || version === 'tlsv1.0' || version === 'tlsv1.1') {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Unsafe SSL/TLS minimum version',
          `Maximum TLS version set to "${value.text.replace(/['"]/g, '')}". This prevents use of modern TLS.`,
          sourceCode,
          'Set maxVersion to "TLSv1.3" or remove the restriction.',
        )
      }
    }

    return null
  },
}
