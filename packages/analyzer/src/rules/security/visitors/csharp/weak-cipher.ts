import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, getCreatedTypeName, isPlainStringLiteral, lastSegment, staticStringText } from './_helpers.js'

/**
 * Broken symmetric ciphers from System.Security.Cryptography: DES, TripleDES
 * and RC2 — factory methods, provider classes, and
 * SymmetricAlgorithm.Create("DES").
 */
const WEAK_CIPHER_RECEIVERS = new Set(['DES', 'TripleDES', 'RC2'])
const WEAK_CIPHER_TYPES = new Set([
  'DESCryptoServiceProvider',
  'TripleDESCryptoServiceProvider', 'TripleDESCng',
  'RC2CryptoServiceProvider',
])
const WEAK_CIPHER_NAMES = /^(?:des|3des|tripledes|rc2)$/i

export const csharpWeakCipherVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-cipher',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    let cipher = ''

    if (node.type === 'object_creation_expression') {
      const typeName = getCreatedTypeName(node)
      if (!WEAK_CIPHER_TYPES.has(typeName)) return null
      cipher = typeName.replace(/(CryptoServiceProvider|Cng)$/, '')
    } else {
      const methodName = getCSharpMethodName(node)
      if (methodName !== 'Create') return null
      const receiver = lastSegment(getCSharpReceiver(node))
      if (WEAK_CIPHER_RECEIVERS.has(receiver)) {
        cipher = receiver
      } else if (receiver === 'SymmetricAlgorithm') {
        const arg = getCallArgs(node)[0]?.value
        if (!arg || !isPlainStringLiteral(arg)) return null
        const name = staticStringText(arg)
        if (!WEAK_CIPHER_NAMES.test(name)) return null
        cipher = name.toUpperCase()
      } else {
        return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Weak cipher algorithm',
      `${cipher} is a cryptographically weak cipher (small block/key size). It must not protect sensitive data.`,
      sourceCode,
      'Use Aes.Create() with GCM (AesGcm) or CBC + HMAC instead.',
    )
  },
}
