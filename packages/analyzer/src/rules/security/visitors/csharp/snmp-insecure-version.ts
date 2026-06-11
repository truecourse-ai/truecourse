import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasUsingPrefix, lastSegment } from './_helpers.js'

/**
 * SNMP v1/v2c (SharpSnmpLib `VersionCode.V1`/`V2`) — community-string
 * protocols with no encryption or real authentication. Requires a
 * Lextm.SharpSnmpLib using so unrelated VersionCode enums never match.
 */
export const csharpSnmpInsecureVersionVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/snmp-insecure-version',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = node.childForFieldName('expression')
    const name = node.childForFieldName('name')
    if (!receiver || !name) return null
    if (lastSegment(receiver.text) !== 'VersionCode') return null
    if (name.text !== 'V1' && name.text !== 'V2') return null
    if (!hasUsingPrefix(node, ['Lextm.SharpSnmpLib'])) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'SNMP insecure version',
      `SNMP ${name.text === 'V1' ? 'v1' : 'v2c'} sends community strings in clear text with no encryption or authentication.`,
      sourceCode,
      'Use VersionCode.V3 with authPriv (authentication + privacy providers).',
    )
  },
}
