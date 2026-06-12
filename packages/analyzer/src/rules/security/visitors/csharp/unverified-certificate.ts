import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget, isAlwaysTrueCallback } from './_helpers.js'

/**
 * TLS certificate validation disabled: a certificate-validation callback
 * assigned an always-true delegate, or
 * HttpClientHandler.DangerousAcceptAnyServerCertificateValidator. Callbacks
 * that actually inspect the certificate/errors are not flagged.
 */
const CERT_CALLBACK_NAMES = new Set([
  'ServerCertificateCustomValidationCallback', // HttpClientHandler / SocketsHttpHandler
  'ServerCertificateValidationCallback',       // ServicePointManager / HttpWebRequest
  'RemoteCertificateValidationCallback',
  'CertificateValidationCallback',
])

export const csharpUnverifiedCertificateVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unverified-certificate',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression', 'member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'member_access_expression') {
      const name = node.childForFieldName('name')
      if (name?.text !== 'DangerousAcceptAnyServerCertificateValidator') return null
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unverified TLS certificate',
        'DangerousAcceptAnyServerCertificateValidator accepts every server certificate, disabling TLS verification.',
        sourceCode,
        'Remove the dangerous validator. Trust the real certificate chain, or pin the expected certificate explicitly.',
      )
    }

    const target = assignmentTarget(node)
    if (!target || !CERT_CALLBACK_NAMES.has(target.name)) return null
    if (!isAlwaysTrueCallback(target.value)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unverified TLS certificate',
      `${target.name} returns true unconditionally, accepting any certificate (including MITM attackers').`,
      sourceCode,
      'Validate the certificate chain (errors == SslPolicyErrors.None) instead of returning true.',
    )
  },
}
