import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A public method that takes a single <c>object</c> parameter and returns
 * <c>object</c>. The two ends are untyped, so callers lose compile-time type safety
 * and the body usually casts the argument back to a concrete type at runtime. A
 * generic type parameter — <c>T M&lt;T&gt;(T value)</c> — preserves the relationship
 * between the argument and the result without a cast (S4047). Kept false-positive
 * free by only flagging the single-<c>object</c>-in, <c>object</c>-out shape on a
 * method whose signature is the author's to change: overrides, <c>virtual</c>/
 * <c>abstract</c> members and explicit interface implementations (bound to a base
 * contract) are left alone, as are extension/<c>ref</c>/<c>out</c>/<c>params</c>
 * parameters and already-generic methods.
 */
export const csharpPreferGenericsOverObjectVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-generics-over-object',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const modifiers = node.children.filter((c) => c?.type === 'modifier').map((c) => c!.text)
    if (!modifiers.includes('public')) return null
    if (modifiers.some((m) => m === 'override' || m === 'virtual' || m === 'abstract')) return null
    if (node.childForFieldName('type_parameters')) return null // already generic

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? ''
    if (name.includes('.')) return null // explicit interface implementation

    if (normalizeType(node.childForFieldName('returns')?.text) !== 'object') return null

    const params = node.childForFieldName('parameters')?.namedChildren.filter(
      (c): c is SyntaxNode => c?.type === 'parameter',
    ) ?? []
    if (params.length !== 1) return null
    const param = params[0]
    if (/^(this|params|ref|out|in)\s/.test(param.text)) return null
    if (normalizeType(param.childForFieldName('type')?.text) !== 'object') return null

    return makeViolation(
      this.ruleKey, nameNode ?? node, filePath, 'low',
      'Object used instead of generics',
      `'${name}' takes and returns object; a generic type parameter (T ${name}<T>(T value)) keeps the call type-safe and drops the runtime cast.`,
      sourceCode,
      `Make ${name} generic — accept and return T instead of object.`,
    )
  },
}

/** Strip a trailing nullable `?` so `object` and `object?` compare equal. */
function normalizeType(text: string | undefined): string {
  return (text ?? '').replace(/\?$/, '')
}
