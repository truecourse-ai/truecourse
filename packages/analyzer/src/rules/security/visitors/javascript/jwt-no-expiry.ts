import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const jwtNoExpiryVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/jwt-no-expiry',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'member_expression') {
      const prop = fn.childForFieldName('property')
      if (prop) methodName = prop.text
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (methodName !== 'sign') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // jwt.sign(payload, secret) — only two args, no options
    if (args.namedChildren.length < 3) {
      // Make sure it's likely jwt by checking for sign pattern
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'JWT signed without expiration',
        'jwt.sign() called without options. JWTs without expiresIn never expire.',
        sourceCode,
        'Add an expiresIn option: jwt.sign(payload, secret, { expiresIn: "1h" }).',
      )
    }

    // jwt.sign(payload, secret, options) — check if expiresIn is absent
    const optionsArg = args.namedChildren[2]
    if (optionsArg?.type === 'object') {
      let hasExpiresIn = false
      for (const prop of optionsArg.namedChildren) {
        if (prop.type === 'pair') {
          const key = prop.childForFieldName('key')
          if (key?.text === 'expiresIn') {
            hasExpiresIn = true
            break
          }
        }
      }
      if (!hasExpiresIn) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'JWT signed without expiration',
          'jwt.sign() options do not include expiresIn. JWTs without expiry never expire.',
          sourceCode,
          'Add expiresIn to the options: { expiresIn: "1h" }.',
        )
      }
    }

    return null
  },
}
