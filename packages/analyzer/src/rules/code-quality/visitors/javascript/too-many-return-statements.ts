import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import { JS_FUNCTION_TYPES, getFunctionBody } from './_helpers.js'

const JSX_RETURN_NODE_TYPES = new Set([
  'jsx_element',
  'jsx_self_closing_element',
  'jsx_fragment',
])

const NESTED_FN_TYPES = new Set([
  'function_declaration',
  'function_expression',
  'arrow_function',
  'method_definition',
])

/**
 * Unwrap `(expr)` / `expr as T` / `<T>expr` / `expr!` / `await expr` /
 * `void expr` so we can classify the underlying returned value shape.
 */
function unwrapReturnValue(node: SyntaxNode | null): SyntaxNode | null {
  let cur: SyntaxNode | null = node
  while (cur) {
    if (cur.type === 'parenthesized_expression') {
      cur = cur.namedChildren.find((c) => c.type !== 'comment') ?? null
      continue
    }
    if (cur.type === 'as_expression' || cur.type === 'satisfies_expression' || cur.type === 'type_assertion') {
      // First named child is the value expression
      cur = cur.namedChildren[0] ?? null
      continue
    }
    if (cur.type === 'non_null_expression') {
      cur = cur.namedChildren[0] ?? null
      continue
    }
    if (cur.type === 'await_expression') {
      cur = cur.namedChildren[0] ?? null
      continue
    }
    if (cur.type === 'unary_expression') {
      // `void expr` / `!expr` etc. — keep going only for `void`
      const op = cur.child(0)
      if (op && op.text === 'void') {
        cur = cur.namedChildren[0] ?? null
        continue
      }
      break
    }
    break
  }
  return cur
}

function isBooleanLiteralExpr(node: SyntaxNode | null): boolean {
  if (!node) return false
  if (node.type === 'true' || node.type === 'false') return true
  // Some tree-sitter grammars expose boolean as a named "true"/"false" leaf;
  // also accept the text-based fallback for safety.
  if ((node.type === 'identifier' || node.type === 'predefined_type') &&
      (node.text === 'true' || node.text === 'false')) return true
  return false
}

function isJsxExpr(node: SyntaxNode | null): boolean {
  if (!node) return false
  return JSX_RETURN_NODE_TYPES.has(node.type)
}

/**
 * Returns true when `node` is inside a `switch_statement` whose nearest
 * enclosing function is `fnNode` (i.e. the switch belongs to this function,
 * not to a nested function we wouldn't count anyway).
 */
function isInsideSwitchOfFunction(node: SyntaxNode, fnNode: SyntaxNode): boolean {
  let p: SyntaxNode | null = node.parent
  while (p && p.id !== fnNode.id) {
    if (p.type === 'switch_statement') return true
    if (NESTED_FN_TYPES.has(p.type)) return false
    p = p.parent
  }
  return false
}

export const tooManyReturnStatementsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-return-statements',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const MAX_RETURNS = 5

    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null
    const bodyId = bodyNode.id

    // Collect all `return_statement` nodes whose nearest enclosing function
    // is `node`, ignoring returns nested inside an inner function expression.
    const returns: SyntaxNode[] = []
    function collect(n: SyntaxNode) {
      if (n.type === 'return_statement') {
        returns.push(n)
        return
      }
      if (n.id !== bodyId && NESTED_FN_TYPES.has(n.type)) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collect(child)
      }
    }
    collect(bodyNode)

    // Partition: switch-case returns are dispatcher branches, not branching
    // complexity for the purpose of this rule (the `too-many-switch-cases`
    // rule already covers wide switches).
    const nonSwitchReturns = returns.filter((r) => !isInsideSwitchOfFunction(r, node))

    if (nonSwitchReturns.length <= MAX_RETURNS) return null

    // Inspect the value shape of each (non-switch) return. Functions whose
    // returns are uniformly JSX (React render components) or uniformly
    // boolean literals (guard-clause predicates / `.filter` callbacks) are
    // dispatcher- or predicate-shaped, not high-complexity branching.
    let jsxReturns = 0
    let booleanReturns = 0
    let valuedReturns = 0
    for (const r of nonSwitchReturns) {
      // `return_statement` has an optional value as its first named child.
      const valueNode = unwrapReturnValue(r.namedChildren[0] ?? null)
      if (!valueNode) continue
      valuedReturns++
      if (isJsxExpr(valueNode)) jsxReturns++
      else if (isBooleanLiteralExpr(valueNode)) booleanReturns++
    }

    if (valuedReturns > 0 && jsxReturns === valuedReturns) return null
    if (valuedReturns > 0 && booleanReturns === valuedReturns) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Too many return statements',
      `Function \`${name}\` has ${nonSwitchReturns.length} return statements (max ${MAX_RETURNS}). Consider refactoring to reduce complexity.`,
      sourceCode,
      'Refactor to reduce the number of return statements, e.g., using early returns, lookup tables, or extracting logic.',
    )
  },
}
