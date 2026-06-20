import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A parameter typed with a nested generic — a generic whose type argument is
 * itself a generic, e.g. `IEnumerable<IEnumerable<T>>` — is hard for callers to
 * construct and read; a named type communicates intent better. The check fires
 * on a `parameter` whose type is a `generic_name` containing another
 * `generic_name` in its `type_argument_list`. `Dictionary<K, V>`,
 * `List<Order>`, `Task<int>` and other single-level generics are fine.
 */
/** The generic_name a type position resolves to, unwrapping a qualified name's
 *  final segment (`System.Collections.Generic.IEnumerable<…>`). */
function asGenericName(typeNode: SyntaxNode | null): SyntaxNode | null {
  if (!typeNode) return null
  if (typeNode.type === 'generic_name') return typeNode
  if (typeNode.type === 'qualified_name') {
    const last = typeNode.childForFieldName('name') ?? typeNode.namedChildren[typeNode.namedChildren.length - 1] ?? null
    return last?.type === 'generic_name' ? last : null
  }
  return null
}

function hasNestedGeneric(typeNode: SyntaxNode): boolean {
  const generic = asGenericName(typeNode)
  if (!generic) return false
  const args = generic.namedChildren.find((c) => c?.type === 'type_argument_list')
  if (!args) return false
  return args.namedChildren.some((arg) => asGenericName(arg) !== null)
}

export const csharpNestedGenericParameterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-generic-parameter',
  languages: ['csharp'],
  nodeTypes: ['parameter'],
  visit(node, filePath, sourceCode) {
    const type = node.childForFieldName('type')
    if (!type || !hasNestedGeneric(type)) return null

    const name = node.childForFieldName('name')?.text ?? 'parameter'
    return makeViolation(
      this.ruleKey, type, filePath, 'low',
      'Nested generic type parameter',
      `Parameter \`${name}\` is typed with a nested generic, which is hard to consume — introduce a named type.`,
      sourceCode,
      'Extract the nested generic into a named type that callers can construct directly.',
    )
  },
}
