import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

/**
 * True if `node` is the type annotation on a variadic parameter
 * (`*args: Any`, `**kwargs: Any`). Variadic param types are
 * almost always `Any` because the annotated function passes
 * arguments through to a wrapped target whose signature isn't
 * known statically.
 */
function isVariadicParam(node: SyntaxNode): boolean {
  // type → typed_parameter → list_splat_pattern / dictionary_splat_pattern
  const parent = node.parent
  if (parent?.type !== 'typed_parameter') return false
  const inner = parent.namedChildren[0]
  if (!inner) return false
  return inner.type === 'list_splat_pattern' || inner.type === 'dictionary_splat_pattern'
}

/**
 * True if `node` is positioned as a generic-type argument —
 * `dict[str, Any]`, `list[Any]`, `Optional[Any]`,
 * `Mapping[str, Any]`. The outer container type IS specific;
 * the inner `Any` represents an unknown VALUE shape (typically
 * JSON / webhook payloads) which is the canonical Python pattern
 * for untyped data.
 */
function isInsideGenericArg(node: SyntaxNode): boolean {
  let cursor: SyntaxNode | null = node.parent
  // Stop after a few hops once we hit the outer annotation root.
  for (let i = 0; i < 6 && cursor; i++) {
    if (cursor.type === 'subscript' || cursor.type === 'generic_type') return true
    if (cursor.type === 'tuple') {
      // The tuple is inside subscript brackets — that's the
      // generic-argument list shape `dict[str, Any]`.
      const grandparent = cursor.parent
      if (grandparent?.type === 'subscript' || grandparent?.type === 'generic_type') return true
    }
    cursor = cursor.parent
  }
  return false
}

/**
 * True if the `type` node's text contains the start of a generic
 * subscript expression — i.e., the node itself wraps something
 * like `dict[str, Any]`. Used as a fallback when the AST walks
 * don't reach `subscript` due to grammar idiosyncrasies.
 */
function typeTextLooksGeneric(node: SyntaxNode): boolean {
  return /[A-Za-z_]\w*\s*\[/.test(node.text) && node.text !== 'Any'
}

export const pythonExplicitAnyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-explicit-any',
  languages: ['python'],
  nodeTypes: ['type'],
  visit(node, filePath, sourceCode) {
    // The outer type expression must be exactly `Any`. Generic
    // containers like `dict[str, Any]` have outer text
    // `dict[str, Any]` and don't match here.
    if (node.text !== 'Any') return null

    // Skip variadic params: `*args: Any`, `**kwargs: Any`. These
    // are passed through to a wrapped function whose signature
    // isn't known; `Any` is the canonical Python annotation.
    if (isVariadicParam(node)) return null

    // Skip when `Any` appears inside a generic-type argument
    // chain (`dict[str, Any]`, `list[Any]`, `Optional[Any]`,
    // `Mapping[str, Any]`). The inner `Any` represents an
    // unknown VALUE shape — JSON, webhook payload, *args
    // forwarding — which has no narrower idiomatic replacement.
    if (isInsideGenericArg(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Explicit `Any` type',
      'Using `Any` bypasses type checking. Use a specific type or protocol instead.',
      sourceCode,
      'Replace `Any` with a specific type, `object`, or a Protocol.',
    )
  },
}
