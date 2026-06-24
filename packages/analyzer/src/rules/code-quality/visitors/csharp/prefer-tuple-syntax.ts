import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * The underlying `ValueTuple<...>` type is written out where C# tuple syntax
 * `(T1, T2, …)` is clearer and idiomatic. The two are identical to the
 * compiler; the parenthesized form reads better and supports element names.
 * The check fires on a `generic_name` named exactly `ValueTuple` with two or
 * more type arguments (a single-element `ValueTuple<T>` has no tuple-syntax
 * equivalent).
 */
export const csharpPreferTupleSyntaxVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-tuple-syntax',
  languages: ['csharp'],
  nodeTypes: ['generic_name'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name') ?? node.namedChildren[0]
    if (name?.text !== 'ValueTuple') return null

    const typeArgs = node.namedChildren.find((c) => c?.type === 'type_argument_list')
    if (!typeArgs || typeArgs.namedChildCount < 2) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer tuple syntax over ValueTuple',
      'The `ValueTuple<…>` type is written out where C# tuple syntax `(T1, T2, …)` is clearer and idiomatic.',
      sourceCode,
      'Use tuple syntax `(T1, T2, …)` instead of the `ValueTuple<…>` type.',
    )
  },
}
