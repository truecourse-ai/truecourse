import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// General-purpose fast hashes — far too cheap to compute to protect a password.
const FAST_HASHES = ['MD5', 'SHA1', 'SHA256', 'SHA384', 'SHA512']
const HASH_CALLS = new Set(['HashData', 'ComputeHash'])
const PASSWORD_RE = /pass(word|wd|phrase)|pwd/i

/**
 * A password run through a general-purpose fast hash (MD5/SHA-family). Those hashes
 * are designed to be cheap, so an attacker who steals the store can brute-force them
 * at billions of guesses per second; passwords need a deliberately-slow,
 * salted key-derivation function (PBKDF2/bcrypt/Argon2). Flagged only when a
 * fast-hash type is the receiver AND a password-named value is hashed, keeping it
 * false-positive free.
 */
export const csharpFastPasswordHashVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/fast-password-hash',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_access_expression') return null
    if (!HASH_CALLS.has(fn.childForFieldName('name')?.text ?? '')) return null

    const receiver = fn.childForFieldName('expression')?.text ?? ''
    if (!FAST_HASHES.some((h) => receiver.includes(h))) return null

    const args = node.childForFieldName('arguments')
    if (!args || !mentionsPassword(args)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Password hashed with a fast algorithm',
      'A password is hashed with a general-purpose fast hash (MD5/SHA-family) — use a slow, salted KDF (PBKDF2/bcrypt/Argon2) instead.',
      sourceCode,
      'Hash passwords with Rfc2898DeriveBytes (PBKDF2), bcrypt or Argon2, with a per-password salt.',
    )
  },
}

function mentionsPassword(node: SyntaxNode): boolean {
  if (node.type === 'identifier' && PASSWORD_RE.test(node.text)) return true
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child && mentionsPassword(child)) return true
  }
  return false
}
