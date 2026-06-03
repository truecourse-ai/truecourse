import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// `void <call()>` is the standard fire-and-forget idiom for an intentionally
// unawaited promise (`void doAsyncThing()`), not a substitute for `undefined`.
// Only `void <literal/identifier>` (canonically `void 0`) is the
// replace-with-`undefined` pattern this rule targets. Walk through parens /
// await / unary wrappers to find whether the operand bottoms out in a call.
function operandIsCall(operand: SyntaxNode | null | undefined): boolean {
  let cur: SyntaxNode | null | undefined = operand
  while (cur) {
    if (cur.type === 'call_expression' || cur.type === 'new_expression') return true
    if (cur.type === 'parenthesized_expression' || cur.type === 'await_expression') {
      // Descend into the wrapped expression (last named child).
      cur = cur.namedChildren[cur.namedChildren.length - 1] ?? null
      continue
    }
    return false
  }
  return false
}

// `void <identifier>;` / `void <obj.member>;` as its own statement is the
// "mark as used" idiom — an explicit reference that pins a side-effect-only
// import or silences unused-variable warnings. The value is never consumed,
// so there's nothing to replace with `undefined`.
function isMarkAsUsedStatement(node: SyntaxNode, operand: SyntaxNode | null | undefined): boolean {
  if (!operand) return false
  if (operand.type !== 'identifier' && operand.type !== 'member_expression') return false
  return node.parent?.type === 'expression_statement'
}

export const voidZeroArgumentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/void-zero-argument',
  languages: JS_LANGUAGES,
  nodeTypes: ['unary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.text === 'void')
    if (!op) return null

    // Skip fire-and-forget `void promiseCall()` — replacing it with `undefined`
    // would drop the call entirely. Only flag literal/identifier operands.
    const operand = node.children[node.children.length - 1]
    if (operandIsCall(operand)) return null
    // Skip the "mark as used" statement idiom: `void engine;`.
    if (isMarkAsUsedStatement(node, operand)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unnecessary void expression',
      `\`${node.text}\` can be replaced with \`undefined\` directly.`,
      sourceCode,
      'Use `undefined` instead of `void 0`.',
    )
  },
}
