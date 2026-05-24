import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Count only DIRECT callback nesting. A callback chain looks like
 *   outerCall(arg, function () { innerCall(function () { ... }) })
 * where each function is the immediate argument of a call. Functions
 * buried inside object/array literals (config DSLs, ts-pattern `.with()`
 * chains, options bags, mappers) are not real callback nesting — they
 * are structural property values — so they don't increment depth.
 */
function isDirectCallbackArg(fn: SyntaxNode): SyntaxNode | null {
  let p: SyntaxNode | null = fn.parent
  while (p?.type === 'parenthesized_expression') p = p.parent
  return p?.type === 'arguments' ? p : null
}

function findEnclosingFn(start: SyntaxNode | null): SyntaxNode | null {
  let n = start
  while (n) {
    if (n.type === 'arrow_function' || n.type === 'function_expression') return n
    if (n.type === 'function_declaration' || n.type === 'method_definition' || n.type === 'program') return null
    n = n.parent
  }
  return null
}

export const deepCallbackNestingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deep-callback-nesting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_expression', 'arrow_function'],
  visit(node, filePath, sourceCode) {
    let depth = 0
    let current: SyntaxNode = node

    while (true) {
      const argsNode = isDirectCallbackArg(current)
      if (!argsNode) break
      depth++
      if (depth >= 4) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Deep callback nesting',
          `Callback nested ${depth} levels deep — refactor using async/await or named functions.`,
          sourceCode,
          'Extract nested callbacks into named functions or use async/await to flatten the nesting.',
        )
      }
      const callExpr = argsNode.parent
      if (!callExpr) break
      const enclosing = findEnclosingFn(callExpr.parent)
      if (!enclosing) break
      current = enclosing
    }
    return null
  },
}
