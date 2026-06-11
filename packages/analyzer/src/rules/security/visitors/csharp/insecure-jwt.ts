import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget } from './_helpers.js'

/**
 * JWT validation weakened to accept forged tokens:
 *   - `RequireSignedTokens = false` (accepts alg=none / unsigned JWTs)
 *   - `SignatureValidator` replaced with a lambda that just re-parses the
 *     token (the classic "skip signature check" override)
 * Tightening flags (ValidateIssuer etc.) are deployment choices and are not
 * flagged.
 */
export const csharpInsecureJwtVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-jwt',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const target = assignmentTarget(node)
    if (!target) return null

    if (target.name === 'RequireSignedTokens' && target.value.text === 'false') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Insecure JWT configuration',
        'RequireSignedTokens = false accepts unsigned (alg: none) JWTs — anyone can forge tokens.',
        sourceCode,
        'Keep RequireSignedTokens = true and configure IssuerSigningKey.',
      )
    }

    if (target.name === 'SignatureValidator' && (target.value.type === 'lambda_expression' || target.value.type === 'anonymous_method_expression')) {
      const body = target.value.childForFieldName('body') ?? target.value.namedChildren[target.value.namedChildren.length - 1]
      const returnsParsedToken = body?.type === 'object_creation_expression' ||
        (body ? /return\s+new\s+\w*(Jwt|Token)/.test(body.text) : false)
      if (returnsParsedToken) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Insecure JWT configuration',
          'SignatureValidator returns the parsed token without verifying the signature — forged tokens are accepted.',
          sourceCode,
          'Remove the custom SignatureValidator and let the handler validate signatures with the configured key.',
        )
      }
    }

    return null
  },
}
