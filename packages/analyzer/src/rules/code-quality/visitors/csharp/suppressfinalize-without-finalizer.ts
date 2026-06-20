import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver, hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * `GC.SuppressFinalize(this)` tells the GC to skip a type's finalizer — but if
 * the type has no finalizer, the call does nothing (S3234). The standard Dispose
 * pattern keeps `SuppressFinalize` on *unsealed* types so a derived type that
 * adds a finalizer is still covered, so this rule only fires on a `sealed` type:
 * a sealed type can have no derived finalizer, so a `SuppressFinalize` with no
 * destructor in the type is provably pointless.
 */
const TYPE_DECLS = new Set(['class_declaration', 'struct_declaration', 'record_declaration'])

function enclosingType(node: SyntaxNode): SyntaxNode | null {
  let current = node.parent
  while (current) {
    if (TYPE_DECLS.has(current.type)) return current
    current = current.parent
  }
  return null
}

function typeHasDestructor(typeDecl: SyntaxNode): boolean {
  const body = typeDecl.namedChildren.find((c) => c?.type === 'declaration_list')
  if (!body) return false
  return body.namedChildren.some((c) => c?.type === 'destructor_declaration')
}

export const csharpSuppressFinalizeWithoutFinalizerVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/suppressfinalize-without-finalizer',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'SuppressFinalize') return null
    if (getCSharpReceiver(node) !== 'GC') return null

    const typeDecl = enclosingType(node)
    if (!typeDecl) return null
    if (!hasCSharpModifier(typeDecl, 'sealed')) return null
    if (typeHasDestructor(typeDecl)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'GC.SuppressFinalize without a finalizer',
      '`GC.SuppressFinalize` is called on a sealed type that has no finalizer, so the call does nothing.',
      sourceCode,
      'Remove the pointless `GC.SuppressFinalize` call, or add the finalizer it is meant to suppress.',
    )
  },
}
