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

    // Ternary used as a statement when both arms are themselves
    // side-effect expressions (call / await / assignment). The
    // statement-form ternary dispatches one of two effects:
    //   `cond ? doA(x) : doB(x);`
    // is equivalent to `if (cond) doA(x); else doB(x);` — neither
    // arm is unused, the result is intentionally discarded.
    if (expr.type === 'ternary_expression') {
      const consequence = expr.namedChildren[1]
      const alternative = expr.namedChildren[2]
      const isEffectful = (n: import('web-tree-sitter').Node | null): boolean => {
        if (!n) return false
        if (n.type === 'call_expression' || n.type === 'await_expression' ||
            n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression' ||
            n.type === 'update_expression' || n.type === 'yield_expression' ||
            n.type === 'new_expression') return true
        if (n.type === 'parenthesized_expression') return isEffectful(n.namedChildren[0] ?? null)
        if (n.type === 'unary_expression') {
          const op = n.children[0]?.text
          if (op === 'void' || op === 'delete') return true
        }
        return false
      }
      if (isEffectful(consequence) && isEffectful(alternative)) return null
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
