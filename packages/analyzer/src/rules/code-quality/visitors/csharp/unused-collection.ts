import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_METHODLIKE_TYPES, isCSharpFunctionBoundary } from './_helpers.js'

const COLLECTION_TYPE_NAMES = new Set([
  'List', 'Dictionary', 'HashSet', 'SortedSet', 'SortedDictionary', 'SortedList',
  'Queue', 'Stack', 'LinkedList', 'ObservableCollection', 'Collection',
  'ConcurrentBag', 'ConcurrentQueue', 'ConcurrentStack', 'ConcurrentDictionary',
  'ArrayList', 'Hashtable', 'StringCollection',
])

const MUTATOR_METHODS = new Set([
  'Add', 'AddRange', 'Insert', 'InsertRange', 'Push', 'Enqueue', 'TryAdd',
  'Remove', 'RemoveAt', 'RemoveAll', 'RemoveRange', 'Clear', 'Sort', 'Reverse',
])

function collectionTypeName(typeNode: SyntaxNode | null): string | null {
  if (!typeNode) return null
  if (typeNode.type === 'generic_name') {
    const base = typeNode.namedChildren.find((c) => c?.type === 'identifier')?.text ?? ''
    return COLLECTION_TYPE_NAMES.has(base) ? base : null
  }
  if (typeNode.type === 'identifier' && COLLECTION_TYPE_NAMES.has(typeNode.text)) return typeNode.text
  if (typeNode.type === 'qualified_name') return collectionTypeName(typeNode.childForFieldName('name'))
  return null
}

/** True when the initializer expression creates a collection. */
function isCollectionInit(value: SyntaxNode, declaredType: SyntaxNode | null): boolean {
  if (value.type === 'object_creation_expression') {
    return collectionTypeName(value.childForFieldName('type')) !== null
  }
  if (value.type === 'implicit_object_creation_expression') {
    // `List<int> xs = new();` — the collection type lives on the declaration.
    return collectionTypeName(declaredType) !== null
  }
  if (value.type === 'array_creation_expression' || value.type === 'implicit_array_creation_expression') return true
  return false
}

/**
 * Sonar S4030 semantics: a local collection whose every subsequent reference
 * only MUTATES it (Add/Push/Enqueue/indexer writes) — its contents are never
 * read, so all that work is dead. Locals with zero references are left to
 * unused-variable; this rule requires at least one write.
 */
export const csharpUnusedCollectionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-collection',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode || bodyNode.type !== 'block') return null

    const collections = new Map<string, SyntaxNode>()

    function collectDecls(n: SyntaxNode) {
      if (isCSharpFunctionBoundary(n.type) && n.id !== node.id) return
      if (n.type === 'local_declaration_statement') {
        const decl = n.namedChildren.find((c) => c?.type === 'variable_declaration')
        const declaredType = decl?.childForFieldName('type') ?? null
        for (const d of decl?.namedChildren ?? []) {
          if (d?.type !== 'variable_declarator') continue
          const nameNode = d.childForFieldName('name')
          // Initializer is the named child after `name`, gated by the `=`.
          const value = d.namedChildren.find((c) => c && c.id !== nameNode?.id)
          if (nameNode?.type === 'identifier' && value && isCollectionInit(value, declaredType)) {
            collections.set(nameNode.text, nameNode)
          }
        }
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) collectDecls(child)
      }
    }
    collectDecls(bodyNode)
    if (collections.size === 0) return null

    const mutated = new Set<string>()
    const read = new Set<string>()

    /** Classify one identifier reference as mutation-only or a read. */
    function classifyReference(n: SyntaxNode) {
      const parent = n.parent
      if (!parent) return
      // The declarator's own name is neither.
      if (parent.type === 'variable_declarator' && parent.childForFieldName('name')?.id === n.id) return

      // `list.Add(x)` — receiver of a mutator invocation. Only counts as
      // write-only when the call's result is discarded: `if (!seen.Add(x))`
      // READS the collection through the return value (the dedup idiom).
      if (parent.type === 'member_access_expression'
        && parent.childForFieldName('expression')?.id === n.id
        && parent.parent?.type === 'invocation_expression'
        && parent.parent.childForFieldName('function')?.id === parent.id) {
        const methodName = parent.childForFieldName('name')?.text ?? ''
        const resultDiscarded = parent.parent.parent?.type === 'expression_statement'
        if (MUTATOR_METHODS.has(methodName) && resultDiscarded) {
          mutated.add(n.text)
          return
        }
        read.add(n.text)
        return
      }

      // `dict[key] = value` — indexer write target.
      if (parent.type === 'element_access_expression'
        && parent.childForFieldName('expression')?.id === n.id
        && parent.parent?.type === 'assignment_expression'
        && parent.parent.childForFieldName('left')?.id === parent.id
        && parent.parent.childForFieldName('operator')?.text === '=') {
        mutated.add(n.text)
        return
      }

      // Everything else — argument, return, foreach source, LINQ receiver,
      // .Count read, reassignment — counts as a read (conservative).
      read.add(n.text)
    }

    function collectRefs(n: SyntaxNode) {
      if (n.type === 'identifier' && collections.has(n.text)) classifyReference(n)
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectRefs(child)
      }
    }
    collectRefs(bodyNode)

    for (const [name, nameNode] of collections) {
      if (name.startsWith('_')) continue
      if (mutated.has(name) && !read.has(name)) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'medium',
          'Unused collection',
          `Collection \`${name}\` is filled but its contents are never read. Remove it or use it.`,
          sourceCode,
          'Remove the collection and the code that fills it, or use its contents.',
        )
      }
    }
    return null
  },
}
