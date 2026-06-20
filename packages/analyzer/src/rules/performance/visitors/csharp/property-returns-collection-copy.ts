import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * A property getter that returns `_field.ToArray()` / `.ToList()` allocates a
 * fresh copy on every read — a hidden O(n) cost callers don't expect from a
 * property. Fires when the getter's sole returned expression is a copying LINQ
 * call (`ToArray`/`ToList`/`ToHashSet`/`ToDictionary`) whose receiver is a plain
 * identifier (a backing field), so getters that compute or project are spared.
 */
const COPY_METHODS = new Set(['ToArray', 'ToList', 'ToHashSet', 'ToDictionary'])

function copyCallOnField(expr: SyntaxNode | null): boolean {
  if (!expr || expr.type !== 'invocation_expression') return false
  if (!COPY_METHODS.has(getCSharpMethodName(expr))) return false
  if (getCSharpArguments(expr).length !== 0) return false
  const fn = expr.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return false
  // Receiver must be a bare identifier (a backing field), not a chain/query.
  return fn.childForFieldName('expression')?.type === 'identifier'
}

function getterReturnExpression(property: SyntaxNode): SyntaxNode | null {
  // Expression-bodied: `public T[] Items => _items.ToArray();`
  const arrow = property.namedChildren.find((c) => c?.type === 'arrow_expression_clause')
  if (arrow) return arrow.namedChildren.find(Boolean) ?? null

  // Accessor body: `get { return _items.ToArray(); }`
  const accessorList = property.namedChildren.find((c) => c?.type === 'accessor_list')
  if (!accessorList) return null
  const getter = accessorList.namedChildren.find(
    (c) => c?.type === 'accessor_declaration' && c.childForFieldName('name')?.text === 'get',
  )
  const body = getter?.childForFieldName('body')
  if (body?.type !== 'block') return null
  const stmts = body.namedChildren.filter((c): c is SyntaxNode => !!c && c.type !== 'comment')
  if (stmts.length !== 1 || stmts[0]!.type !== 'return_statement') return null
  return stmts[0]!.namedChildren.find(Boolean) ?? null
}

export const csharpPropertyReturnsCollectionCopyVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/property-returns-collection-copy',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    if (!copyCallOnField(getterReturnExpression(node))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Property returns a collection copy',
      'A property getter that returns ToArray()/ToList() allocates a fresh copy on every access — a hidden O(n) cost callers will not expect from a property.',
      sourceCode,
      'Expose a read-only view (IReadOnlyList / ReadOnlyCollection) or make it an explicit method so the copy cost is visible.',
    )
  },
}
