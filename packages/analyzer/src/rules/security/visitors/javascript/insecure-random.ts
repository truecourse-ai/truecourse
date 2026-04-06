import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const insecureRandomVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-random',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    if (fn.type === 'member_expression') {
      const obj = fn.childForFieldName('object')
      const prop = fn.childForFieldName('property')
      if (obj?.text === 'Math' && prop?.text === 'random') {
        // Check if it's in a security-sensitive context by looking at ancestors
        let parent = node.parent
        while (parent) {
          const parentText = parent.text.toLowerCase()
          if (parentText.includes('token') || parentText.includes('secret') ||
              parentText.includes('key') || parentText.includes('nonce') ||
              parentText.includes('salt') || parentText.includes('csrf') ||
              parentText.includes('password') || parentText.includes('session')) {
            return makeViolation(
              this.ruleKey, node, filePath, 'high',
              'Insecure random number generator',
              'Math.random() is not cryptographically secure. Do not use it for tokens, keys, or secrets.',
              sourceCode,
              'Use crypto.randomBytes() or crypto.randomUUID() instead.',
            )
          }
          if (parent.type === 'expression_statement' || parent.type === 'variable_declaration' ||
              parent.type === 'assignment_expression' || parent.type === 'lexical_declaration') break
          parent = parent.parent
        }
      }
    }

    return null
  },
}
