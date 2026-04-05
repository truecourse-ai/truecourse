import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const jwtSecretKeyDisclosedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/jwt-secret-key-disclosed',
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

    if (methodName !== 'sign' && methodName !== 'verify') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Second argument is the secret for jwt.sign(payload, secret, ...)
    const secretArg = args.namedChildren[1]
    if (!secretArg) return null

    if (secretArg.type === 'string' || secretArg.type === 'template_string') {
      const val = secretArg.text.replace(/^['"`]|['"`]$/g, '')
      if (val.length >= 4) {
        return makeViolation(
          this.ruleKey, node, filePath, 'critical',
          'JWT secret key hardcoded',
          `jwt.${methodName}() called with a hardcoded secret key. Use an environment variable instead.`,
          sourceCode,
          'Load the JWT secret from process.env.JWT_SECRET or a secrets manager.',
        )
      }
    }

    return null
  },
}
