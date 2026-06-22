import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES, unwrapParens } from './_helpers.js'

/** True when an expression is a bare `null`, or a ternary/coalesce with a null branch. */
function canBeNull(expr: SyntaxNode): boolean {
  const node = unwrapParens(expr)
  if (node.type === 'null_literal') return true
  if (node.type === 'conditional_expression') {
    // cond ? a : b — null in either result branch
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')
    return [consequence, alternative].some((b) => b && canBeNull(b))
  }
  if (node.type === 'binary_expression' && node.childForFieldName('operator')?.text === '??') {
    const right = node.childForFieldName('right')
    return right ? canBeNull(right) : false
  }
  return false
}

/**
 * A return whose value can be null, reachable in this method (not a nested
 * function): a `return null;` statement or an expression-bodied `=> null`.
 */
function findReturnNull(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'arrow_expression_clause') {
    const value = node.namedChildren[0]
    return value && canBeNull(value) ? node : null
  }
  if (node.type === 'return_statement') {
    const value = node.namedChildren[0]
    if (value && canBeNull(value)) return node
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child || CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue
    const found = findReturnNull(child)
    if (found) return found
  }
  return null
}

/**
 * A `ToString()` override that can return `null`. `Object.ToString` is
 * contractually non-null, and countless callers (string interpolation,
 * `Console.WriteLine`, logging, debuggers) assume a non-null string. Returning
 * `null` breaks them in ways that surface far from this override. Return
 * `string.Empty` (or a meaningful value) instead.
 *
 * Only the parameterless `override string ToString()` is considered, and only
 * a directly returned `null` (or a ternary/`??` whose branch is literally
 * `null`) is flagged — values that merely *might* be null at runtime need
 * type/data-flow analysis and are left alone.
 */
export const csharpToStringReturnsNullVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/tostring-returns-null',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('name')?.text !== 'ToString') return null
    const isOverride = node.children.some((c) => c?.type === 'modifier' && c.text === 'override')
    if (!isOverride) return null
    const params = node.childForFieldName('parameters')
    if (params && params.namedChildren.some((p) => p?.type === 'parameter')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const ret = findReturnNull(body)
    if (!ret) return null

    return makeViolation(
      this.ruleKey, ret, filePath, 'medium',
      'ToString() can return null',
      'This `ToString()` override returns `null`, violating the non-null contract that interpolation, logging, and `WriteLine` rely on.',
      sourceCode,
      'Return `string.Empty` or a meaningful representation instead of `null`.',
    )
  },
}
