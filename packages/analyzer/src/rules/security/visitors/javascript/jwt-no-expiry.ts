import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Receivers we treat as jsonwebtoken-style JWT call sites. Bare `sign()` (no
// receiver), call-chain receivers (jose builder pattern), and unrelated
// receivers like `pdfDoc.sign(...)` are deliberately excluded.
function isJwtReceiver(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'jwt' || lower === 'jsonwebtoken' || lower.endsWith('jwt')
}

export const jwtNoExpiryVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/jwt-no-expiry',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Only match `<receiver>.sign(...)` where the receiver is an identifier
    // resembling a jsonwebtoken-style JWT module. This filters out:
    //   - bare `sign(data)` calls (custom HMAC/webhook signers)
    //   - chained builder calls like `new SignJWT(...).setX(...).sign(secret)`
    //     (jose-style — receiver is a `call_expression`, not an identifier)
    //   - unrelated `.sign(...)` methods on non-JWT objects (e.g. `pdfDoc.sign`).
    if (fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || prop.text !== 'sign') return null

    const object = fn.childForFieldName('object')
    if (!object || object.type !== 'identifier') return null
    if (!isJwtReceiver(object.text)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // jsonwebtoken's sign() takes (payload, secret[, options]). Anything with
    // fewer than 2 args isn't the JWT signing shape.
    if (args.namedChildren.length < 2) return null

    // jwt.sign(payload, secret) — no options object at all
    if (args.namedChildren.length < 3) {
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
