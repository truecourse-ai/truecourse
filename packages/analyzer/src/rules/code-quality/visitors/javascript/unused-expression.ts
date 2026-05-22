import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unusedExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-expression',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['expression_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr) return null

    if (expr.type === 'call_expression') return null
    if (expr.type === 'assignment_expression') return null
    if (expr.type === 'augmented_assignment_expression') return null
    if (expr.type === 'update_expression') return null
    if (expr.type === 'await_expression') return null
    if (expr.type === 'yield_expression') return null
    if (expr.type === 'unary_expression' && expr.children[0]?.text === 'delete') return null
    if (expr.type === 'unary_expression' && expr.children[0]?.text === 'void') return null
    if (expr.type === 'string') {
      // Skip directive strings: 'use client', 'use server', 'use strict'
      const stripped = expr.text.replace(/['"]/g, '')
      if (stripped === 'use client' || stripped === 'use server' || stripped === 'use strict') return null
    }
    if (expr.type === 'template_string') return null
    if (expr.type === 'new_expression') return null
    // Skip TypeScript namespace / module declarations. Tree-sitter wraps
    // `namespace Foo { ... }` (and the older `module Foo { ... }` syntax)
    // in an expression_statement, but these are type-level constructs —
    // commonly used inside `declare global { ... }` or
    // `declare module 'x' { ... }` to augment ambient types — and have no
    // runtime side-effect concern of their own.
    if (expr.type === 'internal_module') return null
    if (expr.type === 'module') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unused expression',
      `Expression \`${expr.text.slice(0, 50)}\` has no effect. Did you forget to assign or use the result?`,
      sourceCode,
      'Assign the result to a variable, use it in a condition, or remove the expression.',
    )
  },
}
