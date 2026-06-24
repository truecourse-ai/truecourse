import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCallArgs } from './_helpers.js'

/**
 * `SymmetricAlgorithm.CreateEncryptor(key, iv)` called with an explicit IV
 * argument. Supplying a caller-controlled IV invites reusing the same IV across
 * messages, which breaks CBC confidentiality; the algorithm should generate a
 * fresh random IV per operation via its parameterless CreateEncryptor() (using
 * the freshly-generated `.IV`).
 *
 * Literal/zeroed IVs are the responsibility of predictable-cipher-iv, so this
 * rule fires only on a non-literal (variable/expression) IV to avoid a
 * duplicate finding at the same location.
 */
function isLiteralByteArray(node: SyntaxNode): boolean {
  if (node.type !== 'array_creation_expression') return false
  const type = node.namedChildren.find((c) => c?.type === 'array_type')
  const elem = type?.namedChildren[0]
  if (elem?.type !== 'predefined_type' || elem.text !== 'byte') return false
  const init = node.namedChildren.find((c) => c?.type === 'initializer_expression')
  if (!init) return true
  return init.namedChildren.every(
    (c) => c && (c.type === 'integer_literal' || c.type === 'character_literal' || c.type === 'real_literal'),
  )
}

export const csharpCreateEncryptorNonDefaultIvVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/createencryptor-non-default-iv',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (method !== 'CreateEncryptor' && method !== 'CreateDecryptor') return null
    const args = getCallArgs(node)
    if (args.length < 2) return null
    const ivArg = args[1].value
    // Literal IVs belong to predictable-cipher-iv; only a non-literal IV here.
    if (isLiteralByteArray(ivArg)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'CreateEncryptor with a non-default IV',
      'Supplying an explicit IV to CreateEncryptor risks reusing the same IV across messages, which breaks CBC confidentiality.',
      sourceCode,
      'Call the parameterless CreateEncryptor() and use the algorithm’s freshly generated random IV (.IV) for each operation.',
    )
  },
}
