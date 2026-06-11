import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Membership test against a collection that is empty by construction —
 * `Array.Empty<T>().Contains(x)`, `new List<T>().Contains(x)`,
 * `new T[0].Any(…)` — always false.
 *
 * Mirrors the receiver analysis of empty-collection-access (which owns the
 * indexing shape); this rule owns the Contains/Any membership shape.
 */
const EMPTY_WHEN_NEW = new Set([
  'List', 'HashSet', 'SortedSet', 'Dictionary', 'SortedDictionary', 'SortedList',
  'Queue', 'Stack', 'Collection', 'ObservableCollection',
])

const MEMBERSHIP_METHODS = new Set(['Contains', 'Any', 'ContainsKey', 'ContainsValue'])

function describeEmptyReceiver(expr: SyntaxNode): string | null {
  if (expr.type === 'object_creation_expression') {
    const initializer = expr.childForFieldName('initializer')
      ?? expr.namedChildren.find((c) => c?.type === 'initializer_expression')
    if (initializer && initializer.namedChildren.length > 0) return null
    const type = expr.childForFieldName('type')
    const typeName = type?.type === 'generic_name'
      ? (type.namedChildren.find((c) => c?.type === 'identifier')?.text ?? '')
      : (type?.text ?? '')
    if (!EMPTY_WHEN_NEW.has(typeName)) return null
    const args = expr.childForFieldName('arguments')?.namedChildren ?? []
    // Zero args, or a single int literal (capacity), construct empty; a
    // collection/comparer argument may seed elements — skip those.
    if (args.length > 1) return null
    if (args.length === 1 && args[0]?.namedChildren[0]?.type !== 'integer_literal') return null
    return `a freshly constructed empty ${typeName}`
  }
  if (expr.type === 'array_creation_expression') {
    const initializer = expr.namedChildren.find((c) => c?.type === 'initializer_expression')
    if (initializer) {
      return initializer.namedChildren.length === 0 ? 'an empty array literal' : null
    }
    const rank = expr.childForFieldName('type')?.childForFieldName('rank')
    const size = rank?.namedChildren[0]
    if (size?.type === 'integer_literal' && size.text === '0') return 'a zero-length array'
    return null
  }
  if (expr.type === 'invocation_expression') {
    const fn = expr.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const receiver = fn.childForFieldName('expression')?.text ?? ''
    const name = fn.childForFieldName('name')
    const method = name?.type === 'generic_name'
      ? (name.namedChildren.find((c) => c?.type === 'identifier')?.text ?? '')
      : (name?.text ?? '')
    if (method !== 'Empty') return null
    if (receiver === 'Array' || receiver.endsWith('.Array')) return 'Array.Empty<T>()'
    if (receiver === 'Enumerable' || receiver.endsWith('.Enumerable')) return 'Enumerable.Empty<T>()'
    return null
  }
  return null
}

export const csharpInEmptyCollectionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/in-empty-collection',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const method = fn.childForFieldName('name')?.text ?? ''
    if (!MEMBERSHIP_METHODS.has(method)) return null

    const receiver = fn.childForFieldName('expression')
    if (!receiver) return null
    const description = describeEmptyReceiver(receiver)
    if (!description) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Membership test on empty collection',
      `\`.${method}(…)\` on ${description} always returns \`false\` — the collection has no elements.`,
      sourceCode,
      'Check the intended collection, or populate it before testing membership.',
    )
  },
}
