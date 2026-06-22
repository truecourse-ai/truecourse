import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, isPlainStringLiteral, lastSegment } from './_helpers.js'

/**
 * PBKDF2 (`new Rfc2898DeriveBytes(password, salt, ...)` / `Pbkdf2(...)`) fed a
 * *constant* salt — a byte-array literal, a string literal, or
 * `Encoding.*.GetBytes("literal")`. A shared, predictable salt lets one
 * precomputed table attack every password; the salt must be random per
 * password.
 */
function isLiteralByteArray(node: SyntaxNode): boolean {
  if (node.type !== 'array_creation_expression') return false
  const type = node.namedChildren.find((c) => c?.type === 'array_type')
  const elem = type?.namedChildren[0]
  if (elem?.type !== 'predefined_type' || elem.text !== 'byte') return false
  const init = node.namedChildren.find((c) => c?.type === 'initializer_expression')
  if (!init) return false // zero-filled `new byte[16]` is empty, not a constant set
  return init.namedChildren.every(
    (c) => c && (c.type === 'integer_literal' || c.type === 'character_literal' || c.type === 'real_literal'),
  )
}

function isConstantStringBytes(node: SyntaxNode): boolean {
  // Encoding.UTF8.GetBytes("literal")
  if (node.type !== 'invocation_expression') return false
  if (getCSharpMethodName(node) !== 'GetBytes') return false
  if (!/Encoding/.test(getCSharpReceiver(node))) return false
  const arg = getCallArgs(node)[0]?.value
  return !!arg && isPlainStringLiteral(arg)
}

function isConstantSalt(node: SyntaxNode | undefined): boolean {
  if (!node) return false
  if (isPlainStringLiteral(node)) return true
  if (isLiteralByteArray(node)) return true
  return isConstantStringBytes(node)
}

/** The salt argument: named `salt`, else the 2nd positional (ctor) / 3rd (Pbkdf2). */
function saltArg(node: SyntaxNode, positionalIndex: number): SyntaxNode | undefined {
  const args = getCallArgs(node)
  const named = args.find((a) => a.name === 'salt')
  if (named) return named.value
  return args.filter((a) => a.name === null)[positionalIndex]?.value
}

export const csharpPasswordHashUnpredictableSaltVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/password-hash-unpredictable-salt',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression'],
  visit(node, filePath, sourceCode) {
    let arg: SyntaxNode | undefined
    if (node.type === 'object_creation_expression') {
      const type = node.childForFieldName('type') ?? node.namedChildren[0]
      if (lastSegment(type?.text ?? '') !== 'Rfc2898DeriveBytes') return null
      arg = saltArg(node, 1)
    } else {
      if (getCSharpMethodName(node) !== 'Pbkdf2') return null
      if (lastSegment(getCSharpReceiver(node)) !== 'Rfc2898DeriveBytes') return null
      arg = saltArg(node, 2)
    }

    if (!isConstantSalt(arg)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Password hashing uses a predictable salt',
      'A constant salt lets a single precomputed table attack every password; the salt must be random and unique per password.',
      sourceCode,
      'Generate a fresh random salt per password with RandomNumberGenerator.GetBytes() and store it alongside the hash.',
    )
  },
}
