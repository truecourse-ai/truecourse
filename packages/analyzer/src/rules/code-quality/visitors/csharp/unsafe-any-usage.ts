import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * C# analog of TypeScript's unsafe-`any`: the `dynamic` keyword. Every
 * member access, call and conversion on a `dynamic` value bypasses
 * compile-time checking, exactly like `any`. Unlike the TS rule this needs
 * no type checker — `dynamic` is explicit in the syntax.
 */
function isTypePosition(node: SyntaxNode): boolean {
  const parent = node.parent
  if (!parent) return false
  if (parent.childForFieldName('type')?.id === node.id) return true
  if (parent.childForFieldName('returns')?.id === node.id) return true
  // Generic argument: List<dynamic>, Dictionary<string, dynamic>.
  if (parent.type === 'type_argument_list') return true
  return false
}

export const csharpUnsafeAnyUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unsafe-any-usage',
  languages: ['csharp'],
  nodeTypes: ['identifier'],
  visit(node, filePath, sourceCode) {
    if (node.text !== 'dynamic') return null
    if (!isTypePosition(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Use of `dynamic` bypasses type checking',
      '`dynamic` defers all member resolution to runtime — typos and contract changes surface as runtime exceptions instead of compile errors.',
      sourceCode,
      'Replace `dynamic` with a concrete type, a generic parameter, or `object` plus pattern matching.',
    )
  },
}
