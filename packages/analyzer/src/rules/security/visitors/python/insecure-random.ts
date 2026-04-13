import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const SECURITY_SENSITIVE_NAMES = ['token', 'secret', 'key', 'nonce', 'salt', 'password', 'session']

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

    // Check if used in security-sensitive context by inspecting the assignment target
    let current = node.parent
    while (current && current.type !== 'assignment' && current.type !== 'expression_statement') {
      current = current.parent
    }
    if (current?.type === 'assignment') {
      const target = current.childForFieldName('left')
      if (target) {
        const targetName = target.text.toLowerCase()
        if (SECURITY_SENSITIVE_NAMES.some(n => targetName.includes(n))) {
          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Insecure random number generator',
            `random.${methodName}() is not cryptographically secure. Do not use it for tokens, keys, or secrets.`,
            sourceCode,
            'Use secrets.token_hex() or secrets.token_urlsafe() instead.',
          )
        }
      }
    }

    return null
  },
}
