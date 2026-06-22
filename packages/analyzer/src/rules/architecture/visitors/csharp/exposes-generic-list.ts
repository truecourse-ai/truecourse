import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A public method that returns `List<T>` leaks an implementation choice into
 * the API surface: callers can mutate it freely and the backing collection can
 * never be swapped. Return IList<T>, ICollection<T> or IReadOnlyList<T>.
 *
 * Scoped to method return types. Settable `List<T>` *properties* are
 * deliberately not flagged: they are idiomatic on EF Core entities, DTOs and
 * serialization models (the deserializer needs a concrete, settable list), so
 * flagging them is a false-positive wall.
 */
function isGenericList(typeNode: SyntaxNode | null): boolean {
  if (typeNode?.type !== 'generic_name') return false
  const id = typeNode.namedChildren.find((c) => c?.type === 'identifier')?.text
  return id === 'List'
}

export const csharpExposesGenericListVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/exposes-generic-list',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public')) return null

    const typeNode = node.childForFieldName('returns')
    if (!isGenericList(typeNode)) return null

    const memberName = node.childForFieldName('name')?.text ?? 'member'
    return makeViolation(
      this.ruleKey, typeNode!, filePath, 'low',
      'List<T> in public API',
      `Method '${memberName}' returns List<T> in its public signature, leaking an implementation detail.`,
      sourceCode,
      'Return IList<T>, ICollection<T> or IReadOnlyList<T> instead of the concrete List<T>.',
    )
  },
}
