import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Collection types whose parameterless construction is empty AND whose
// indexer reads existing entries (so indexing a fresh instance always
// throws). Arbitrary types are skipped — a custom indexer may compute.
const EMPTY_WHEN_NEW = new Set([
  'List', 'Collection', 'ObservableCollection', 'Dictionary', 'SortedDictionary', 'SortedList',
])

function describeEmpty(expr: SyntaxNode): string | null {
  if (expr.type === 'object_creation_expression') {
    if (expr.childForFieldName('initializer')) return null
    const type = expr.childForFieldName('type')
    const typeName = type?.type === 'generic_name'
      ? (type.namedChildren.find((c) => c?.type === 'identifier')?.text ?? '')
      : (type?.text ?? '')
    if (!EMPTY_WHEN_NEW.has(typeName)) return null
    const args = expr.childForFieldName('arguments')?.namedChildren ?? []
    if (args.length > 0) return null // capacity / copy constructors
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
    if (method === 'Empty' && (receiver === 'Array' || receiver.endsWith('.Array'))) {
      return 'Array.Empty<T>()'
    }
    return null
  }
  return null
}

/**
 * Indexing a collection that is empty by construction —
 * `new List<int>()[0]`, `Array.Empty<string>()[i]`, `new int[0][n]` —
 * always throws (ArgumentOutOfRange / IndexOutOfRange / KeyNotFound).
 */
export const csharpEmptyCollectionAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-collection-access',
  languages: ['csharp'],
  nodeTypes: ['element_access_expression'],
  visit(node, filePath, sourceCode) {
    const expr = node.childForFieldName('expression')
    if (!expr) return null

    const description = describeEmpty(expr)
    if (!description) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Empty collection access',
      `Indexing ${description} — the collection has no elements, so this always throws at runtime.`,
      sourceCode,
      'Check that you are accessing the correct collection, or populate it first.',
    )
  },
}
