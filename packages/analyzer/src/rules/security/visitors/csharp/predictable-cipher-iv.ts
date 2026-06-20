import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { assignmentTarget, getCallArgs } from './_helpers.js'

/**
 * A constant or zeroed initialization vector for a symmetric cipher: an
 * `array_creation_expression` of bytes that is either uninitialized (zero
 * filled — `new byte[16]`) or fully literal (`new byte[] { 0x00, ... }`),
 * used either as `cipher.IV = ...` or as the IV argument of
 * `CreateEncryptor`/`CreateDecryptor`. A constant IV undermines CBC's
 * security (it must be unpredictable per message).
 */
function isLiteralByteArray(node: SyntaxNode): boolean {
  if (node.type !== 'array_creation_expression') return false
  const type = node.namedChildren.find((c) => c?.type === 'array_type')
  const elem = type?.namedChildren[0]
  if (elem?.type !== 'predefined_type' || elem.text !== 'byte') return false

  const init = node.namedChildren.find((c) => c?.type === 'initializer_expression')
  if (!init) return true // zero-filled
  // every element a numeric/char literal → fully constant
  return init.namedChildren.every(
    (c) => c && (c.type === 'integer_literal' || c.type === 'character_literal' || c.type === 'real_literal'),
  )
}

export const csharpPredictableCipherIvVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/predictable-cipher-iv',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression', 'invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'assignment_expression') {
      const target = assignmentTarget(node)
      if (!target || target.name !== 'IV') return null
      if (!isLiteralByteArray(target.value)) return null
    } else {
      const method = getCSharpMethodName(node)
      if (method !== 'CreateEncryptor' && method !== 'CreateDecryptor') return null
      const ivArg = getCallArgs(node)[1]?.value
      if (!ivArg || !isLiteralByteArray(ivArg)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Predictable cipher initialization vector',
      'A constant or zero-filled IV undermines CBC cipher security — the IV must be unpredictable and unique per message.',
      sourceCode,
      'Generate a fresh random IV per message with RandomNumberGenerator.GetBytes() and prepend it to the ciphertext.',
    )
  },
}
