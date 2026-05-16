import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Unwrap parenthesized / type-cast wrappers to look at the underlying expression. */
function unwrap(node: SyntaxNode): SyntaxNode {
  let cur: SyntaxNode | null = node
  while (
    cur &&
    (cur.type === 'parenthesized_expression' ||
      cur.type === 'type_assertion' ||
      cur.type === 'as_expression' ||
      cur.type === 'satisfies_expression' ||
      cur.type === 'non_null_expression')
  ) {
    const inner: SyntaxNode | undefined = cur.namedChildren[0]
    if (!inner) break
    cur = inner
  }
  return cur ?? node
}

/**
 * True when the expression is or contains a side-effectful sub-expression
 * (call, await, yield, assignment, update, new, dynamic import, throw).
 * Used to identify intentional side-effects in short-circuit/ternary positions.
 */
function hasSideEffect(node: SyntaxNode | null | undefined): boolean {
  if (!node) return false
  const n = unwrap(node)
  switch (n.type) {
    case 'call_expression':
    case 'await_expression':
    case 'yield_expression':
    case 'assignment_expression':
    case 'augmented_assignment_expression':
    case 'update_expression':
    case 'new_expression':
    case 'throw_expression':
      return true
    default:
      return false
  }
}

/** Walk ancestors; return true if any ancestor is an ERROR (parser recovery) node. */
function hasErrorAncestor(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'ERROR') return true
    cur = cur.parent
  }
  return false
}

export const unusedExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-expression',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const rawExpr = node.namedChildren[0]
    if (!rawExpr) return null

    // Parse-recovery noise: any expression_statement nested inside an ERROR
    // ancestor is almost certainly a misparse rather than real code.
    if (hasErrorAncestor(node)) return null

    const expr = unwrap(rawExpr)

    if (expr.type === 'call_expression') return null
    if (expr.type === 'assignment_expression') return null
    if (expr.type === 'augmented_assignment_expression') return null
    if (expr.type === 'update_expression') return null
    if (expr.type === 'await_expression') return null
    if (expr.type === 'yield_expression') return null
    if (expr.type === 'throw_expression') return null
    if (expr.type === 'new_expression') return null

    // TypeScript namespace bodies (`namespace X { ... }`, including those inside
    // `declare global { ... }` / `declare module 'x' { ... }`) are parsed by
    // tree-sitter as `expression_statement > internal_module`. These are
    // declarations, not runtime expressions.
    if (expr.type === 'internal_module') return null

    // Bare function/class/arrow expression-statements: typically parse-recovery
    // artifacts (e.g. `declare function f: (x) => void;` recovered as an arrow
    // expression-statement). Idiomatic IIFE/function declarations don't appear
    // as standalone expression-statements without a call.
    if (
      expr.type === 'arrow_function' ||
      expr.type === 'function_expression' ||
      expr.type === 'function' ||
      expr.type === 'generator_function' ||
      expr.type === 'class' ||
      expr.type === 'class_expression'
    ) {
      return null
    }

    if (expr.type === 'unary_expression' && expr.children[0]?.text === 'delete') return null
    if (expr.type === 'unary_expression' && expr.children[0]?.text === 'void') return null

    if (expr.type === 'string') {
      // Skip directive strings: 'use client', 'use server', 'use strict'
      const stripped = expr.text.replace(/['"]/g, '')
      if (stripped === 'use client' || stripped === 'use server' || stripped === 'use strict') return null
    }
    if (expr.type === 'template_string') return null

    // Short-circuit guard pattern: `cond && fn()`, `cond || fn()`, `cond ?? fn()`.
    // When the RHS is itself a side-effectful expression the statement is an
    // intentional conditional call, not a discarded value.
    if (expr.type === 'binary_expression') {
      const opNode = expr.children.find((c: SyntaxNode | null) => c && !c.isNamed)
      const op = opNode?.text
      if ((op === '&&' || op === '||' || op === '??') && hasSideEffect(expr.namedChildren[1])) {
        return null
      }
    }

    // Ternary used as a conditional dispatch: `cond ? fn1() : fn2()` where both
    // branches are side-effectful. The statement-level discard is intentional.
    if (expr.type === 'ternary_expression') {
      const consequent = expr.namedChildren[1]
      const alternative = expr.namedChildren[2]
      if (hasSideEffect(consequent) && hasSideEffect(alternative)) {
        return null
      }
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unused expression',
      `Expression \`${expr.text.slice(0, 50)}\` has no effect. Did you forget to assign or use the result?`,
      sourceCode,
      'Assign the result to a variable, use it in a condition, or remove the expression.',
    )
  },
}
