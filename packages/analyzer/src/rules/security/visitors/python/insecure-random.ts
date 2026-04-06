import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonInsecureRandomVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-random',
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

    if (objectName !== 'random') return null
    if (methodName !== 'random' && methodName !== 'randint' && methodName !== 'choice') return null

    // Check if used in security-sensitive context
    let parent = node.parent
    while (parent) {
      const parentText = parent.text.toLowerCase()
      if (parentText.includes('token') || parentText.includes('secret') ||
          parentText.includes('key') || parentText.includes('nonce') ||
          parentText.includes('salt') || parentText.includes('password') ||
          parentText.includes('session')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Insecure random number generator',
          `random.${methodName}() is not cryptographically secure. Do not use it for tokens, keys, or secrets.`,
          sourceCode,
          'Use secrets.token_hex() or secrets.token_urlsafe() instead.',
        )
      }
      if (parent.type === 'expression_statement' || parent.type === 'assignment') break
      parent = parent.parent
    }

    return null
  },
}
