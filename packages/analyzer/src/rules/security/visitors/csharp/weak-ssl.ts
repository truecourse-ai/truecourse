import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInComparisonContext, lastSegment } from './_helpers.js'

/**
 * Deprecated TLS protocol selections: SslProtocols.Ssl2/Ssl3/Tls/Tls11 and
 * SecurityProtocolType.Ssl3/Tls/Tls11 (`SslProtocols.Tls` is TLS 1.0).
 * `SslProtocols.None` is NOT flagged — it delegates protocol choice to the
 * OS and is the recommended .NET default.
 */
const WEAK_SSL_MEMBERS: Record<string, Set<string>> = {
  SslProtocols: new Set(['Ssl2', 'Ssl3', 'Tls', 'Tls11', 'Default']),
  SecurityProtocolType: new Set(['Ssl3', 'Tls', 'Tls11']),
}

export const csharpWeakSslVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-ssl',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = node.childForFieldName('expression')
    const name = node.childForFieldName('name')
    if (!receiver || !name) return null
    const enumName = lastSegment(receiver.text)
    const members = WEAK_SSL_MEMBERS[enumName]
    if (!members || !members.has(name.text)) return null
    if (isInComparisonContext(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Weak SSL/TLS protocol',
      `${enumName}.${name.text} enables a deprecated protocol (SSLv2/SSLv3/TLS 1.0/1.1 are insecure).`,
      sourceCode,
      'Use SslProtocols.Tls12 or Tls13 — or SslProtocols.None to let the OS pick the best protocol.',
    )
  },
}
