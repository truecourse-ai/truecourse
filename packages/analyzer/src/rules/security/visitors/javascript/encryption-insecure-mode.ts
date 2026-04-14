import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const encryptionInsecureModeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/encryption-insecure-mode',
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

    if (methodName !== 'createCipheriv' && methodName !== 'createDecipheriv') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    const argText = firstArg.text.replace(/['"]/g, '').toLowerCase()
    if (argText.includes('ecb')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Insecure encryption mode',
        `ECB mode ("${firstArg.text.replace(/['"]/g, '')}") does not provide semantic security. Identical plaintext blocks produce identical ciphertext.`,
        sourceCode,
        'Use GCM or CBC mode instead of ECB (e.g., aes-256-gcm).',
      )
    }

    return null
  },
}
