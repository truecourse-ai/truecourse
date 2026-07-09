import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Nodes that, when evaluated, do something observable — so an expression
// statement containing one in evaluated position is intentional, not "unused".
const SIDE_EFFECT_TYPES = new Set([
  'call_expression', 'new_expression',
  'assignment_expression', 'augmented_assignment_expression',
  'update_expression', 'await_expression', 'yield_expression',
])

// Bodies that are only executed when invoked — a call *inside* them is not
// evaluated by merely mentioning the function/class, so don't descend into them.
const UNEVALUATED_BODY_TYPES = new Set([
  'function_declaration', 'function_expression', 'function', 'arrow_function',
  'generator_function', 'generator_function_declaration', 'method_definition', 'class',
])

/**
 * Whether evaluating this expression does something observable. This is what
 * separates a genuinely dead expression statement (`foo.bar;`, `a + b;`) from
 * intentional idioms that merely wrap a call: `!function(){…}()` and other
 * IIFE prefixes, UMD comma-sequences `(root = root || self, factory(root))`,
 * short-circuit calls `cond && run()`, and ternary dispatch `ok ? a() : b()`.
 */
function hasSideEffect(n: SyntaxNode): boolean {
  if (SIDE_EFFECT_TYPES.has(n.type)) return true
  // `delete x` mutates; `void x` is an explicit "evaluate-and-discard" idiom.
  if (n.type === 'unary_expression') {
    const op = n.children[0]?.text
    if (op === 'delete' || op === 'void') return true
  }
  // A call written inside a function/class body only runs when that body is
  // invoked — which, if it happens, is itself a call node we'd already have seen.
  if (UNEVALUATED_BODY_TYPES.has(n.type)) return false
  for (let i = 0; i < n.childCount; i++) {
    const child = n.child(i)
    if (child && hasSideEffect(child)) return true
  }
  return false
}

export const unusedExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-expression',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null

    if (expr.type === 'string') {
      // Skip directive strings: 'use client', 'use server', 'use strict'
      const stripped = expr.text.replace(/['"]/g, '')
      if (stripped === 'use client' || stripped === 'use server' || stripped === 'use strict') return null
    }
    if (expr.type === 'template_string') return null
    // Skip TypeScript namespace / module declarations. Tree-sitter wraps
    // `namespace Foo { ... }` (and the older `module Foo { ... }` syntax)
    // in an expression_statement, but these are type-level constructs —
    // commonly used inside `declare global { ... }` or
    // `declare module 'x' { ... }` to augment ambient types — and have no
    // runtime side-effect concern of their own.
    if (expr.type === 'internal_module') return null
    if (expr.type === 'module') return null

    // Anything that actually executes something — a call, assignment, IIFE
    // (including `!function(){}()` / UMD comma-sequence forms), short-circuit
    // call, or ternary dispatch — is intentional, not a dead expression.
    if (hasSideEffect(expr)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unused expression',
      `Expression \`${expr.text.slice(0, 50)}\` has no effect. Did you forget to assign or use the result?`,
      sourceCode,
      'Assign the result to a variable, use it in a condition, or remove the expression.',
    )
  },
}
