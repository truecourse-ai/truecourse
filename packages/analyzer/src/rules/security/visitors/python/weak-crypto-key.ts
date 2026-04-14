import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonWeakCryptoKeyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-crypto-key',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (methodName !== 'generate_private_key') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Look for key_size keyword argument
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'key_size' && value) {
          const num = parseInt(value.text, 10)
          if (!isNaN(num) && num < 2048) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Weak cryptographic key size',
              `RSA key size ${num} bits is too small. Minimum recommended is 2048 bits.`,
              sourceCode,
              'Use at least 2048-bit RSA keys: rsa.generate_private_key(key_size=2048, ...).',
            )
          }
        }
      }
    }

    return null
  },
}
