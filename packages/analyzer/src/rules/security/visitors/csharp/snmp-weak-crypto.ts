import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCreatedTypeName, hasUsingPrefix } from './_helpers.js'

/**
 * SNMPv3 with weak crypto providers (SharpSnmpLib): MD5/SHA-1
 * authentication or DES privacy.
 */
const WEAK_SNMP_PROVIDERS = new Set([
  'MD5AuthenticationProvider',
  'SHA1AuthenticationProvider',
  'DESPrivacyProvider',
])

export const csharpSnmpWeakCryptoVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/snmp-weak-crypto',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const typeName = getCreatedTypeName(node)
    if (!WEAK_SNMP_PROVIDERS.has(typeName)) return null
    if (!hasUsingPrefix(node, ['Lextm.SharpSnmpLib'])) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'SNMP weak cryptography',
      `${typeName} uses a weak algorithm for SNMPv3 security.`,
      sourceCode,
      'Use SHA256AuthenticationProvider (or stronger) and AESPrivacyProvider.',
    )
  },
}
