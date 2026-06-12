import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, hasUsingPrefix } from './_helpers.js'

/**
 * SignedXml.CheckSignature() with no arguments verifies against the key
 * embedded in the document itself — an attacker can re-sign tampered XML
 * with their own key. Only fires in files using
 * System.Security.Cryptography.Xml.
 */
export const csharpUnsafeXmlSignatureVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/unsafe-xml-signature',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'CheckSignature') return null
    if (getCallArgs(node).length !== 0) return null
    if (!hasUsingPrefix(node, ['System.Security.Cryptography.Xml'])) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unsafe XML signature verification',
      'CheckSignature() without a key trusts the key embedded in the signed document — attackers can substitute their own.',
      sourceCode,
      'Pass the expected key or certificate: CheckSignature(trustedKey) / CheckSignature(cert, true).',
    )
  },
}
