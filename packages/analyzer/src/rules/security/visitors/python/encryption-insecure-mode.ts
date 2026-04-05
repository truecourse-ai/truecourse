import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonEncryptionInsecureModeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/encryption-insecure-mode',
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

    if (methodName !== 'new') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // AES.new(key, AES.MODE_ECB) — second positional arg or mode= keyword
    for (const arg of args.namedChildren) {
      if (arg.type === 'attribute') {
        const attrName = arg.childForFieldName('attribute')
        if (attrName?.text === 'MODE_ECB') {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Insecure encryption mode',
            'ECB mode does not provide semantic security. Identical plaintext blocks produce identical ciphertext.',
            sourceCode,
            'Use MODE_GCM or MODE_CBC instead of MODE_ECB.',
          )
        }
      }
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'mode' && value?.text.includes('MODE_ECB')) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Insecure encryption mode',
            'ECB mode does not provide semantic security. Identical plaintext blocks produce identical ciphertext.',
            sourceCode,
            'Use MODE_GCM or MODE_CBC instead of MODE_ECB.',
          )
        }
      }
    }

    return null
  },
}
