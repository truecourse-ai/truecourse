import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const WEAK_CIPHERS = new Set(['des', 'des-ede', 'des-ede3', 'rc4', 'blowfish', 'bf', 'bf-cbc', 'bf-ecb'])

export const weakCipherVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-cipher',
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

    if (methodName !== 'createCipher' && methodName !== 'createCipheriv' && methodName !== 'createDecipher' && methodName !== 'createDecipheriv') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text.replace(/['"]/g, '').toLowerCase()
    for (const cipher of WEAK_CIPHERS) {
      if (argText === cipher || argText.startsWith(cipher + '-')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Weak cipher algorithm',
          `Using weak cipher "${argText}". DES, RC4, and Blowfish are cryptographically broken.`,
          sourceCode,
          'Use AES-256-GCM or AES-256-CBC instead.',
        )
      }
    }

    return null
  },
}
