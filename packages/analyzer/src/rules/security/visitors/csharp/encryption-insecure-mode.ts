import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInComparisonContext, lastSegment } from './_helpers.js'

/**
 * `CipherMode.ECB` used as a value (assignment/initializer/argument). ECB
 * leaks plaintext structure — identical blocks encrypt identically.
 * Comparisons (`if (aes.Mode == CipherMode.ECB) reject()`) are validation,
 * not use, and are skipped.
 */
export const csharpEncryptionInsecureModeVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/encryption-insecure-mode',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    const receiver = node.childForFieldName('expression')
    const name = node.childForFieldName('name')
    if (!receiver || !name) return null
    if (lastSegment(receiver.text) !== 'CipherMode' || name.text !== 'ECB') return null
    if (isInComparisonContext(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Insecure encryption mode',
      'CipherMode.ECB does not provide semantic security — identical plaintext blocks produce identical ciphertext.',
      sourceCode,
      'Use authenticated encryption (AesGcm) or CipherMode.CBC with an HMAC.',
    )
  },
}
