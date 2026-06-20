import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInComparisonContext, lastSegment } from './_helpers.js'

/**
 * A current `SslProtocols` value (Tls12/Tls13) hardcoded as a value. Pinning
 * even a modern protocol freezes the TLS version and prevents `SslProtocols.None`
 * (the OS default) from selecting a newer one. Deprecated values
 * (Ssl2/Ssl3/Tls/Tls11) are the separate `weak-ssl` rule and are not re-flagged
 * here; comparisons are validation, not configuration.
 */
const PINNED_VERSIONS = new Set(['Tls12', 'Tls13'])

export const csharpHardcodedSslProtocolsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-sslprotocols',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = node.childForFieldName('expression')
    const name = node.childForFieldName('name')
    if (!receiver || !name) return null
    if (lastSegment(receiver.text) !== 'SslProtocols') return null
    if (!PINNED_VERSIONS.has(name.text)) return null
    if (isInComparisonContext(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Hardcoded SslProtocols value',
      `SslProtocols.${name.text} hardcodes a TLS version, preventing the OS default (SslProtocols.None) from selecting a newer protocol as it becomes available.`,
      sourceCode,
      'Use SslProtocols.None to let the OS choose the best available protocol.',
    )
  },
}
