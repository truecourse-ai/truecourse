import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const PYTHON_WEAK_CIPHER_CLASSES = new Set(['DES', 'DES3', 'ARC4', 'Blowfish', 'XOR'])

export const pythonWeakCipherVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-cipher',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    }

    // DES.new(), ARC4.new(), Blowfish.new()
    if (methodName === 'new' && PYTHON_WEAK_CIPHER_CLASSES.has(objectName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Weak cipher algorithm',
        `${objectName}.new() uses a weak cipher. ${objectName} is cryptographically broken.`,
        sourceCode,
        'Use AES from Crypto.Cipher instead.',
      )
    }

    return null
  },
}
