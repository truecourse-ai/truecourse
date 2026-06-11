import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, getCreatedTypeName, isPlainStringLiteral, staticStringText } from './_helpers.js'

/**
 * JWT signing key hardcoded in source:
 * `new SymmetricSecurityKey(Encoding.UTF8.GetBytes("literal"))` (or
 * Convert.FromBase64String("literal")). Keys loaded from configuration or
 * environment never match.
 */
const BYTE_CONVERSION_METHODS = new Set(['GetBytes', 'FromBase64String'])

function literalKeyText(arg: SyntaxNode): string | null {
  if (isPlainStringLiteral(arg)) return staticStringText(arg)
  if (arg.type === 'invocation_expression' && BYTE_CONVERSION_METHODS.has(getCSharpMethodName(arg))) {
    const inner = getCallArgs(arg)[0]?.value
    if (inner && isPlainStringLiteral(inner)) return staticStringText(inner)
  }
  return null
}

export const csharpJwtSecretKeyDisclosedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/jwt-secret-key-disclosed',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCreatedTypeName(node) !== 'SymmetricSecurityKey') return null
    const arg = getCallArgs(node)[0]?.value
    if (!arg) return null
    const literal = literalKeyText(arg)
    if (literal === null || literal.length < 4) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      'JWT secret key hardcoded',
      'SymmetricSecurityKey built from a hardcoded string. Anyone with source access can forge tokens.',
      sourceCode,
      'Load the signing key from configuration/secrets (e.g. configuration["Jwt:Key"]) or a key vault.',
    )
  },
}
