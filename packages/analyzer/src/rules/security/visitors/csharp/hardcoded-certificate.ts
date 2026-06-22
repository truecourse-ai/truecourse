import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCallArgs, getCreatedTypeName, isPlainStringLiteral } from './_helpers.js'

/**
 * `new X509Certificate(...)` / `new X509Certificate2(...)` whose first argument
 * is an inline byte-array literal — `new byte[] { 0x30, 0x82, ... }` — meaning
 * the certificate (and any embedded private key) is baked into the binary,
 * where anyone with the assembly can extract it.
 *
 * Restricted to a byte-array-literal first argument: a file path or a `byte[]`
 * variable loaded from elsewhere is the normal, safe pattern.
 */
function isByteArrayLiteral(node: SyntaxNode | undefined): boolean {
  if (!node || node.type !== 'array_creation_expression') return false
  const type = node.namedChildren.find((c) => c?.type === 'array_type')
  const elem = type?.namedChildren[0]
  if (elem?.type !== 'predefined_type' || elem.text !== 'byte') return false
  return node.namedChildren.some((c) => c?.type === 'initializer_expression')
}

const CERT_TYPES = new Set(['X509Certificate', 'X509Certificate2'])

export const csharpHardcodedCertificateVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-certificate',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    if (!CERT_TYPES.has(getCreatedTypeName(node))) return null
    const first = getCallArgs(node)[0]?.value
    if (!isByteArrayLiteral(first)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Hardcoded certificate',
      'Constructing an X509 certificate from an inline byte-array literal bakes the certificate (and any embedded key) into the binary, where it can be extracted.',
      sourceCode,
      'Load the certificate from a protected store (certificate store, Key Vault, or a file with restricted permissions) at runtime.',
    )
  },
}
