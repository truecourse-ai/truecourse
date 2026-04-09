import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Security-related variable name keywords that indicate cryptographic use */
const SECURITY_KEYWORDS = ['token', 'secret', 'key', 'nonce', 'salt', 'csrf', 'password', 'session', 'hash', 'iv']

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
        // Skip random array index selection pattern: Math.floor(Math.random() * arr.length)
        // This is a common non-security pattern for shuffling or picking random elements.
        const parentNode = node.parent
        if (parentNode?.type === 'binary_expression') {
          const parentText = parentNode.text
          if (/\.length\b/.test(parentText)) return null
        }

        // Check if it's in a security-sensitive context by looking at ancestors
        let parent = node.parent
        while (parent) {
          const parentText = parent.text.toLowerCase()
          // Only flag when the context involves security-sensitive variable names
          if (SECURITY_KEYWORDS.some((kw) => parentText.includes(kw))) {
            // Double-check: skip if this is just array index selection even within
            // a broader security context (e.g., picking from an array of allowed chars)
            const immediateParent = node.parent
            if (immediateParent?.type === 'binary_expression' && /\.length\b/.test(immediateParent.text)) {
              return null
            }

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
