import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget, getInitializerAssignments } from './_helpers.js'

/**
 * `TokenValidationParameters` with a validation check turned off —
 * `ValidateIssuer`, `ValidateAudience`, `ValidateLifetime`,
 * `ValidateIssuerSigningKey`, `ValidateActor`, or `ValidateTokenReplay` set to
 * `false` — via an object initializer or a property assignment. Disabling any
 * of these weakens token verification (e.g. accepting tokens from any issuer or
 * past their lifetime).
 *
 * The signature/expiry flags (`RequireSignedTokens`, `RequireExpirationTime`)
 * are owned by the insecure-jwt / jwt-no-expiry rules and are excluded here to
 * avoid duplicate findings.
 */
const VALIDATION_FLAGS = new Set([
  'ValidateIssuer',
  'ValidateAudience',
  'ValidateLifetime',
  'ValidateIssuerSigningKey',
  'ValidateActor',
  'ValidateTokenReplay',
])

function isDisabled(value: SyntaxNode | undefined): boolean {
  return value?.type === 'boolean_literal' && value.text === 'false'
}

export const csharpTokenValidationDisabledVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/token-validation-disabled',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    let disabled: string | null = null
    if (node.type === 'assignment_expression') {
      // Initializer assignments are handled by the object-creation branch.
      if (node.parent?.type === 'initializer_expression') return null
      const target = assignmentTarget(node)
      if (!target || !VALIDATION_FLAGS.has(target.name) || !isDisabled(target.value)) return null
      disabled = target.name
    } else {
      const type = node.childForFieldName('type') ?? node.namedChildren[0]
      if (type?.text !== 'TokenValidationParameters') return null
      const hit = getInitializerAssignments(node).find((a) => VALIDATION_FLAGS.has(a.name) && isDisabled(a.value))
      if (!hit) return null
      disabled = hit.name
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Token validation check disabled',
      `${disabled} = false weakens token verification, allowing tokens that should be rejected to be accepted.`,
      sourceCode,
      'Leave the validation checks enabled and supply the expected issuer/audience/signing keys.',
    )
  },
}
