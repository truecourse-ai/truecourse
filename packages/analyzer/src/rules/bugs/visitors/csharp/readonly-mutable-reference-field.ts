import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Simple, generic mutable BCL collection types. `readonly` on a field of one of
 * these only freezes the reference — callers can still `Add`, `Remove`, clear,
 * or index-assign the contents, so the field gives a false sense of
 * immutability. The immutable (`IReadOnlyList`, `ImmutableArray`, …) and
 * frozen counterparts are intentionally not listed.
 */
const MUTABLE_GENERIC_TYPES = new Set([
  'List',
  'Dictionary',
  'HashSet',
  'SortedList',
  'SortedDictionary',
  'SortedSet',
  'Queue',
  'Stack',
  'LinkedList',
  'Collection',
  'ObservableCollection',
  'ConcurrentDictionary',
  'ConcurrentBag',
  'ConcurrentQueue',
  'ConcurrentStack',
])

/** Right-most simple name of a (possibly qualified, possibly generic) type. */
function typeSimpleName(typeNode: SyntaxNode): { name: string; isArray: boolean } | null {
  let node: SyntaxNode = typeNode
  if (node.type === 'array_type') return { name: '', isArray: true }
  if (node.type === 'qualified_name') {
    const right = node.namedChildren[node.namedChildren.length - 1]
    if (!right) return null
    node = right
  }
  if (node.type === 'generic_name') {
    const id = node.childForFieldName('name') ?? node.namedChildren[0]
    return id ? { name: id.text, isArray: false } : null
  }
  return null
}

const VISIBLE_MODIFIERS = new Set(['public', 'protected', 'internal'])

/**
 * An externally visible `readonly` field whose declared type is a mutable array
 * or generic collection (`List<T>`, `Dictionary<,>`, `T[]`, …). `readonly` only
 * prevents reassigning the reference; the elements stay freely mutable, so to a
 * consumer the field advertises an immutability it does not have — outside code
 * reading it can still mutate the contents. Either expose a read-only view
 * (`IReadOnlyList<T>`, `ImmutableArray<T>`) or drop the misleading `readonly`.
 *
 * Only non-`private` instance fields are flagged: a `private readonly List<T>`
 * mutated only inside its own type is the idiomatic, correct pattern, and the
 * exposed-`static readonly` collection is the distinct shared-global-state
 * concern covered by `mutable-public-static-field`.
 */
export const csharpReadonlyMutableReferenceFieldVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/readonly-mutable-reference-field',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    const modifiers = node.children.filter((c) => c?.type === 'modifier').map((c) => c!.text)
    if (!modifiers.includes('readonly')) return null
    if (modifiers.includes('const')) return null
    // Exposed static readonly collections are the shared-global concern owned by
    // mutable-public-static-field; this rule is the instance-field case.
    if (modifiers.includes('static')) return null
    // Only externally reachable fields mislead a consumer about immutability.
    if (!modifiers.some((m) => VISIBLE_MODIFIERS.has(m))) return null

    const decl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    const typeNode = decl?.namedChildren[0]
    if (!typeNode) return null

    const simple = typeSimpleName(typeNode)
    if (!simple) return null
    if (!simple.isArray && !MUTABLE_GENERIC_TYPES.has(simple.name)) return null

    const fieldName = decl?.namedChildren
      .find((c) => c?.type === 'variable_declarator')
      ?.childForFieldName('name')?.text

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'readonly field holds a mutable collection',
      `\`readonly\` only freezes the reference of \`${fieldName ?? '?'}\`; its ${simple.isArray ? 'array' : `\`${simple.name}\``} contents can still be changed, so the field is not actually immutable.`,
      sourceCode,
      'Expose a read-only view (IReadOnlyList<T>, ImmutableArray<T>) or remove the misleading `readonly`.',
    )
  },
}
