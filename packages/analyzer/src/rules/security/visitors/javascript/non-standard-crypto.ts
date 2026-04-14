import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const NON_STANDARD_CRYPTO_PATTERNS = [
  /xor.?crypt/i,
  /rot13/i,
  /caesar.?cipher/i,
  /vigenere/i,
  /homebrew.?crypt/i,
  /custom.?encrypt/i,
  /simple.?encrypt/i,
  /my.?encrypt/i,
]

export const nonStandardCryptoVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/non-standard-crypto',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'variable_declarator', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode =
      node.childForFieldName('name') ??
      (node.type === 'variable_declarator' ? node.childForFieldName('name') : null)
    if (!nameNode) return null

    const name = nameNode.text.toLowerCase()
    for (const pattern of NON_STANDARD_CRYPTO_PATTERNS) {
      if (pattern.test(name)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Non-standard cryptography',
          `"${nameNode.text}" appears to implement custom/non-standard cryptography. Use a vetted library instead.`,
          sourceCode,
          'Use the Node.js built-in crypto module or a well-known library like libsodium.',
        )
      }
    }

    return null
  },
}
