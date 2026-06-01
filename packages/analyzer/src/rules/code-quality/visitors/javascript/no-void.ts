import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// `void <call()>` is the standard fire-and-forget idiom for an intentionally
// unawaited promise — not a confusing stand-in for `undefined`. Only flag
// `void <literal/identifier>`. Descend through parens / await wrappers.
function operandIsCall(operand: SyntaxNode | null | undefined): boolean {
  let cur: SyntaxNode | null | undefined = operand
  while (cur) {
    if (cur.type === 'call_expression' || cur.type === 'new_expression') return true
    if (cur.type === 'parenthesized_expression' || cur.type === 'await_expression') {
      cur = cur.namedChildren[cur.namedChildren.length - 1] ?? null
      continue
    }
    return false
  }
  return false
}

export const noVoidVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-void',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.children[0]
    if (operator?.text !== 'void') return null
    const operand = node.children[1]
    if (operand?.text === '0') return null

    // Skip the fire-and-forget `void promiseCall()` idiom.
    if (operandIsCall(operand)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Void expression',
      'The `void` operator is confusing. Use `undefined` directly or omit the return value.',
      sourceCode,
      'Replace `void expr` with `undefined` or remove the expression.',
    )
  },
}
