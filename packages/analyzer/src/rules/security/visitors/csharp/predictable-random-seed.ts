import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, getCreatedTypeName } from './_helpers.js'

/**
 * A cryptographic RNG (BouncyCastle `SecureRandom`) seeded with predictable
 * input: `new SecureRandom(constantBytes)` or `rng.SetSeed(constant)` where the
 * argument is a literal. Seeding a CSPRNG with a constant makes its output
 * reproducible, defeating the point of using one.
 */
function isConstantSeed(arg: SyntaxNode | undefined): boolean {
  if (!arg) return false
  if (arg.type === 'integer_literal' || arg.type === 'real_literal' || arg.type === 'character_literal') return true
  // new byte[] { 0x00, ... } — all-literal byte array
  if (arg.type === 'array_creation_expression') {
    const init = arg.namedChildren.find((c) => c?.type === 'initializer_expression')
    if (!init) return true
    return init.namedChildren.every((c) => c && (c.type === 'integer_literal' || c.type === 'character_literal'))
  }
  return false
}

export const csharpPredictableRandomSeedVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/predictable-random-seed',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression', 'invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'object_creation_expression') {
      if (getCreatedTypeName(node) !== 'SecureRandom') return null
      if (!isConstantSeed(getCallArgs(node)[0]?.value)) return null
    } else {
      if (getCSharpMethodName(node) !== 'SetSeed') return null
      if (!isConstantSeed(getCallArgs(node)[0]?.value)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Predictable secure-random seed',
      'Seeding a cryptographic RNG with a constant makes its output reproducible, defeating the purpose of a secure generator.',
      sourceCode,
      'Let the CSPRNG self-seed from the OS entropy source — do not provide a fixed seed.',
    )
  },
}
