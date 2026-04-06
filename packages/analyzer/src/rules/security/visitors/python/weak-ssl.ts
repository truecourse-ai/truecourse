import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_WEAK_SSL_ATTRS = new Set([
  'PROTOCOL_SSLv2', 'PROTOCOL_SSLv3', 'PROTOCOL_SSLv23',
  'PROTOCOL_TLSv1', 'PROTOCOL_TLS',
])

export const pythonWeakSslVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-ssl',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const attr = node.childForFieldName('attribute')
    const obj = node.childForFieldName('object')

    if (obj?.text === 'ssl' && attr && PYTHON_WEAK_SSL_ATTRS.has(attr.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Weak SSL/TLS protocol',
        `ssl.${attr.text} uses a deprecated protocol. SSLv2, SSLv3, and TLS 1.0 are insecure.`,
        sourceCode,
        'Use ssl.PROTOCOL_TLS_CLIENT or ssl.create_default_context() for modern TLS.',
      )
    }

    return null
  },
}
