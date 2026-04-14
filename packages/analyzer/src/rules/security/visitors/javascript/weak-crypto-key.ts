import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const weakCryptoKeyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-crypto-key',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    }

    if (methodName !== 'generateKeyPair' && methodName !== 'generateKeyPairSync') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const keyType = firstArg.text.replace(/['"]/g, '').toLowerCase()

    // Look for options object
    for (const arg of args.namedChildren) {
      if (arg.type === 'object') {
        for (const prop of arg.namedChildren) {
          if (prop.type === 'pair') {
            const key = prop.childForFieldName('key')
            const value = prop.childForFieldName('value')

            // RSA: modulusLength < 2048
            if (keyType === 'rsa' && key?.text === 'modulusLength' && value) {
              const num = parseInt(value.text, 10)
              if (!isNaN(num) && num < 2048) {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'Weak cryptographic key size',
                  `RSA key size ${num} bits is too small. Minimum recommended is 2048 bits.`,
                  sourceCode,
                  'Use at least 2048-bit RSA keys (preferably 4096).',
                )
              }
            }

            // EC: namedCurve with small key
            if (keyType === 'ec' && key?.text === 'namedCurve' && value) {
              const curve = value.text.replace(/['"]/g, '').toLowerCase()
              // P-192 (secp192r1) and P-224 (secp224r1) are too small
              if (curve === 'secp192r1' || curve === 'p-192' || curve === 'prime192v1' ||
                  curve === 'secp224r1' || curve === 'p-224') {
                return makeViolation(
                  this.ruleKey, node, filePath, 'high',
                  'Weak cryptographic key size',
                  `EC curve "${curve}" provides less than 256 bits of security.`,
                  sourceCode,
                  'Use P-256 (secp256r1) or stronger curves.',
                )
              }
            }
          }
        }
      }
    }

    return null
  },
}
