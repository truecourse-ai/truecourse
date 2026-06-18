import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const LIST_LIKE_TYPES = new Set(['List', 'Collection', 'ObservableCollection'])

/** Number of plain elements in a literal collection, or null when not literal/simple. */
function literalElementCount(expr: SyntaxNode): number | null {
  let initializer: SyntaxNode | null = null
  if (expr.type === 'implicit_array_creation_expression' || expr.type === 'array_creation_expression') {
    initializer = expr.namedChildren.find((c) => c?.type === 'initializer_expression') ?? null
    if (!initializer) return null
  } else if (expr.type === 'object_creation_expression') {
    const type = expr.childForFieldName('type')
    const typeName = type?.type === 'generic_name'
      ? (type.namedChildren.find((c) => c?.type === 'identifier')?.text ?? '')
      : (type?.text ?? '')
    if (!LIST_LIKE_TYPES.has(typeName)) return null
    initializer = expr.childForFieldName('initializer')
    if (!initializer) return null
  } else {
    return null
  }

  const elements = initializer.namedChildren.filter(Boolean) as SyntaxNode[]
  // Dictionary-style `{ { k, v } }` / `[k] = v` initializers are not positional.
  if (elements.some((e) => e.type === 'initializer_expression' || e.type === 'assignment_expression')) return null
  return elements.length
}

/**
 * Indexing a literal collection with a constant index that is out of
 * range: `new[] { "a", "b" }[2]`, `new List<int> { 1 } [^2]` — always
 * throws IndexOutOfRangeException / ArgumentOutOfRangeException.
 */
export const csharpPotentialIndexErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/potential-index-error',
  languages: ['csharp'],
  nodeTypes: ['element_access_expression'],
  visit(node, filePath, sourceCode) {
    const expr = node.childForFieldName('expression')
    if (!expr) return null
    const count = literalElementCount(expr)
    if (count === null || count === 0) return null // empty-collection-access owns n = 0

    const index = node.childForFieldName('subscript')?.namedChildren[0]?.namedChildren[0]
    if (!index) return null

    if (index.type === 'integer_literal') {
      const value = Number(index.text)
      if (!Number.isInteger(value) || value < count) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Index out of range',
        `Accessing index \`${value}\` on a literal collection with ${count} element${count !== 1 ? 's' : ''} — this always throws at runtime.`,
        sourceCode,
        `Use an index between 0 and ${count - 1}.`,
      )
    }

    // From-end index: ^k is element count-k, so ^0 is always out of range
    // and ^k with k > count underflows.
    if (index.type === 'prefix_unary_expression' && index.children[0]?.type === '^') {
      const inner = index.namedChildren[0]
      if (inner?.type !== 'integer_literal') return null
      const k = Number(inner.text)
      if (k !== 0 && k <= count) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Index out of range',
        `Accessing from-end index \`^${k}\` on a literal collection with ${count} element${count !== 1 ? 's' : ''} — ${k === 0 ? '`^0` equals the collection length and' : 'the index underflows and'} always throws at runtime.`,
        sourceCode,
        `Use a from-end index between ^1 and ^${count}.`,
      )
    }

    return null
  },
}
