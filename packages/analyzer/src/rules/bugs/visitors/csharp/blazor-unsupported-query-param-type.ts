import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Generic collection types Blazor cannot bind from the query string. Multi-valued
// query parameters bind to an ARRAY of a supported scalar; a List/Dictionary/etc.
// is rejected at runtime.
const UNSUPPORTED_COLLECTIONS = new Set([
  'List', 'IList', 'ICollection', 'IEnumerable', 'IReadOnlyList', 'IReadOnlyCollection',
  'Collection', 'ObservableCollection', 'HashSet', 'ISet', 'Dictionary', 'IDictionary',
  'IReadOnlyDictionary', 'SortedList', 'SortedSet', 'Queue', 'Stack', 'LinkedList',
])

/**
 * A Blazor <c>[SupplyParameterFromQuery]</c> property typed as a generic collection.
 * Query-string binding accepts only the supported scalar types (string, bool, numeric,
 * Guid, DateTime…) and arrays of them; a <c>List&lt;T&gt;</c>, <c>Dictionary&lt;,&gt;</c>
 * or other generic collection is not bindable and throws at runtime. Matched by
 * attribute name (no Blazor reference assemblies needed) and scoped to generic
 * collection types — the unambiguous case — so a supported scalar or array never fires.
 */
export const csharpBlazorUnsupportedQueryParamTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/blazor-unsupported-query-param-type',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    if (!attributeNames(node).includes('SupplyParameterFromQuery')) return null

    const type = node.childForFieldName('type')
    const base = genericBaseName(type)
    if (!base || !UNSUPPORTED_COLLECTIONS.has(base)) return null

    const name = node.childForFieldName('name')
    return makeViolation(
      this.ruleKey, type ?? node, filePath, 'medium',
      'Unsupported Blazor query parameter type',
      `'${name?.text ?? ''}' is bound from the query string as ${base}<…>, which Blazor cannot bind — use an array of a supported scalar type instead.`,
      sourceCode,
      'Bind the query parameter to a supported scalar type or an array of one (e.g. int[]).',
    )
  },
}

/** Base type name of a `generic_name` (`List<int>` → 'List'); null for non-generic types. */
function genericBaseName(type: SyntaxNode | null): string | null {
  if (type?.type !== 'generic_name') return null
  return type.namedChildren.find((c) => c?.type === 'identifier')?.text ?? null
}

/** Attribute names (last segment, `Attribute` suffix stripped) applied to a declaration. */
function attributeNames(node: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of node.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const n = attr.childForFieldName('name')?.text
      if (n) names.push((n.split('.').pop() ?? n).replace(/Attribute$/, ''))
    }
  }
  return names
}
