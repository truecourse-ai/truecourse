import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget, getCreatedTypeName, getInitializerAssignments } from './_helpers.js'

/**
 * Tokens minted without an expiry: a SecurityTokenDescriptor that configures
 * signing/claims but never sets Expires, or token validation with
 * `RequireExpirationTime = false`. (JwtSecurityToken positional ctors are
 * not analyzed — overload ambiguity would risk FPs.)
 */
export const csharpJwtNoExpiryVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/jwt-no-expiry',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'object_creation_expression') {
      if (getCreatedTypeName(node) !== 'SecurityTokenDescriptor') return null
      const props = getInitializerAssignments(node)
      if (props.length === 0) return null
      const names = new Set(props.map((p) => p.name))
      if (!names.has('SigningCredentials') && !names.has('Subject') && !names.has('Claims')) return null
      if (names.has('Expires')) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'JWT signed without expiration',
        'SecurityTokenDescriptor has no Expires — the issued token never expires.',
        sourceCode,
        'Set Expires (e.g. DateTime.UtcNow.AddMinutes(30)) on the token descriptor.',
      )
    }

    const target = assignmentTarget(node)
    if (!target || target.name !== 'RequireExpirationTime' || target.value.text !== 'false') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'JWT signed without expiration',
      'RequireExpirationTime = false accepts tokens that never expire.',
      sourceCode,
      'Keep RequireExpirationTime = true so stolen tokens age out.',
    )
  },
}
