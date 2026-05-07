import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Known JWT library specifiers. The rule is too noisy without an
// import gate — there are countless `.sign()` methods in the wild
// (custom HMAC helpers, PDF/PKCS7 signing libs, signature pads,
// crypto wrappers) that have nothing to do with JWT. Without the
// gate, every documenso `pdf.sign(...)` and project-local
// `sign(payload)` helper produces a high-severity FP.
const JWT_LIB_SPECIFIERS = /\bfrom\s+['"](jsonwebtoken|jose|@nestjs\/jwt|fast-jwt)['"]/

// Methods on jose's chained SignJWT builder that imply expiration
// is being set up the chain. When the receiver of `.sign(secret)`
// contains a call to one of these, the builder DID set expiry —
// the rule must not fire on the terminal `.sign()`.
//   new SignJWT(...).setProtectedHeader(...).setExpirationTime(exp).sign(secret)
const JOSE_EXPIRY_HINTS = /\bset(?:ExpirationTime)\b|\bexpiresIn\b/

export const jwtNoExpiryVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/jwt-no-expiry',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    // Must be a file that imports a JWT library. Otherwise `.sign()` is
    // far more likely to be HMAC, PDF, or some unrelated helper.
    if (!JWT_LIB_SPECIFIERS.test(sourceCode)) return null

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

    // jose's chained-builder pattern: walk the receiver chain (everything
    // textually before `.sign`) for an expiration setter. If found, skip.
    if (fn.type === 'member_expression') {
      const receiver = fn.childForFieldName('object')
      if (receiver && JOSE_EXPIRY_HINTS.test(receiver.text)) return null
    }

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
