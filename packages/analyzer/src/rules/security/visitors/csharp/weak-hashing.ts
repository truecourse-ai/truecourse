import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, getCreatedTypeName, isPlainStringLiteral, lastSegment, staticStringText } from './_helpers.js'

/**
 * MD5/SHA1 from System.Security.Cryptography: MD5.Create(), SHA1.HashData(),
 * the *CryptoServiceProvider/Managed/Cng classes, and
 * HashAlgorithm.Create("MD5"). HMACMD5/HMACSHA1 are not flagged — HMAC-SHA1
 * remains required by interop protocols like TOTP (RFC 6238).
 */
const WEAK_HASH_RECEIVERS = new Set(['MD5', 'SHA1'])
const WEAK_HASH_FACTORY_METHODS = new Set(['Create', 'HashData', 'HashDataAsync', 'TryHashData'])
const WEAK_HASH_TYPES = new Set([
  'MD5CryptoServiceProvider', 'MD5Cng',
  'SHA1CryptoServiceProvider', 'SHA1Managed', 'SHA1Cng',
])
const WEAK_HASH_NAMES = /^(?:md5|sha-?1)$/i

export const csharpWeakHashingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-hashing',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    let algorithm = ''

    if (node.type === 'object_creation_expression') {
      const typeName = getCreatedTypeName(node)
      if (!WEAK_HASH_TYPES.has(typeName)) return null
      algorithm = typeName.startsWith('MD5') ? 'MD5' : 'SHA1'
    } else {
      const methodName = getCSharpMethodName(node)
      const receiver = lastSegment(getCSharpReceiver(node))
      if (WEAK_HASH_RECEIVERS.has(receiver) && WEAK_HASH_FACTORY_METHODS.has(methodName)) {
        algorithm = receiver
      } else if ((receiver === 'HashAlgorithm' && methodName === 'Create') || (receiver === 'CryptoConfig' && methodName === 'CreateFromName')) {
        const arg = getCallArgs(node)[0]?.value
        if (!arg || !isPlainStringLiteral(arg)) return null
        const name = staticStringText(arg)
        if (!WEAK_HASH_NAMES.test(name)) return null
        algorithm = name.toUpperCase()
      } else {
        return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Weak hashing algorithm',
      `${algorithm} is cryptographically broken (collision attacks). Do not use it for security purposes.`,
      sourceCode,
      'Use SHA256.Create()/SHA256.HashData() or stronger (SHA-384, SHA-512).',
    )
  },
}
