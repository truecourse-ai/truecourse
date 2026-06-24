import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { lastSegment } from './_helpers.js'

/**
 * A class that derives from a cryptographic base type — a hand-rolled hash or
 * cipher. Rolling your own crypto primitive (instead of using a vetted,
 * standard algorithm) is a classic source of weakness.
 */
const CRYPTO_BASE_TYPES = new Set([
  'HashAlgorithm', 'KeyedHashAlgorithm', 'HMAC',
  'SymmetricAlgorithm', 'AsymmetricAlgorithm',
  'DeriveBytes', 'AsymmetricKeyExchangeFormatter', 'AsymmetricKeyExchangeDeformatter',
  'AsymmetricSignatureFormatter', 'AsymmetricSignatureDeformatter',
])

function baseTypeNames(cls: SyntaxNode): string[] {
  const baseList = cls.namedChildren.find((c) => c?.type === 'base_list')
  if (!baseList) return []
  const out: string[] = []
  for (const base of baseList.namedChildren) {
    if (!base) continue
    out.push(lastSegment(base.text))
  }
  return out
}

export const csharpCustomCryptoAlgorithmVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/custom-crypto-algorithm',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const bases = baseTypeNames(node)
    if (!bases.some((b) => CRYPTO_BASE_TYPES.has(b))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Custom cryptographic algorithm',
      'This class derives from a cryptographic base type, implementing a hand-rolled hash or cipher. Custom crypto is error-prone and rarely secure.',
      sourceCode,
      'Use a standard, vetted algorithm from System.Security.Cryptography instead of deriving your own.',
    )
  },
}
