import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, getCreatedTypeName, lastSegment } from './_helpers.js'

/**
 * RSA/DSA keys below 2048 bits: `new RSACryptoServiceProvider(1024)`,
 * `RSA.Create(1024)`. Only literal key sizes are checked.
 */
const ASYMMETRIC_PROVIDER_TYPES = new Set(['RSACryptoServiceProvider', 'RSACng', 'DSACryptoServiceProvider', 'DSACng'])
const ASYMMETRIC_RECEIVERS = new Set(['RSA', 'DSA'])
const MIN_KEY_BITS = 2048

function literalKeySize(arg: SyntaxNode | undefined): number | null {
  if (!arg || arg.type !== 'integer_literal') return null
  const value = parseInt(arg.text.replace(/_/g, ''), 10)
  return Number.isNaN(value) ? null : value
}

export const csharpWeakCryptoKeyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/weak-crypto-key',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    let context = ''
    let keySize: number | null = null

    if (node.type === 'object_creation_expression') {
      const typeName = getCreatedTypeName(node)
      if (!ASYMMETRIC_PROVIDER_TYPES.has(typeName)) return null
      keySize = literalKeySize(getCallArgs(node)[0]?.value)
      context = `new ${typeName}()`
    } else {
      if (getCSharpMethodName(node) !== 'Create') return null
      const receiver = lastSegment(getCSharpReceiver(node))
      if (!ASYMMETRIC_RECEIVERS.has(receiver)) return null
      keySize = literalKeySize(getCallArgs(node)[0]?.value)
      context = `${receiver}.Create()`
    }

    if (keySize === null || keySize >= MIN_KEY_BITS) return null
    // Key sizes are powers-of-two-ish bit counts; tiny ints are something else.
    if (keySize < 256) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Weak cryptographic key size',
      `${context} with a ${keySize}-bit key. Keys below ${MIN_KEY_BITS} bits are breakable.`,
      sourceCode,
      'Use at least 2048-bit RSA/DSA keys (preferably 3072+), or switch to ECDsa P-256.',
    )
  },
}
