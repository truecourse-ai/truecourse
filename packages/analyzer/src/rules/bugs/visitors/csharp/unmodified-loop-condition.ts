import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/**
 * A while loop whose simple binary condition reads variables that the body
 * never modifies — the loop can never make progress. Any invocation or await
 * in the condition or body bails out (calls can change state, awaits yield),
 * so producer/consumer and busy-wait helpers don't fire.
 */
function containsType(n: SyntaxNode, types: Set<string>): boolean {
  if (types.has(n.type)) return true
  for (let i = 0; i < n.childCount; i++) {
    const child = n.child(i)
    if (child && containsType(child, types)) return true
  }
  return false
}

const STATE_CHANGERS = new Set(['invocation_expression', 'await_expression', 'member_access_expression', 'element_access_expression'])

export const csharpUnmodifiedLoopConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unmodified-loop-condition',
  languages: ['csharp'],
  nodeTypes: ['while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition || condition.type !== 'binary_expression') return null

    const left = condition.childForFieldName('left')
    const right = condition.childForFieldName('right')
    if (!left || !right) return null

    // Properties (`queue.Count`) and calls are implicitly time-varying.
    if (containsType(condition, STATE_CHANGERS)) return null

    const condVars: string[] = []
    if (left.type === 'identifier') condVars.push(left.text)
    if (right.type === 'identifier') condVars.push(right.text)
    if (condVars.length === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function isModified(n: SyntaxNode): boolean {
      if (n.type === 'assignment_expression') {
        const lhs = n.childForFieldName('left')
        if (lhs && condVars.includes(lhs.text)) return true
      }
      if (n.type === 'postfix_unary_expression' || n.type === 'prefix_unary_expression') {
        const hasIncDec = n.children.some((c) => c?.type === '++' || c?.type === '--')
        const arg = n.namedChildren[0]
        if (hasIncDec && arg && condVars.includes(arg.text)) return true
      }
      // Calls and awaits can modify anything (including via ref/out)
      if (n.type === 'invocation_expression' || n.type === 'await_expression' || n.type === 'yield_statement') return true
      if (CSHARP_FUNCTION_BOUNDARIES.has(n.type)) return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && isModified(child)) return true
      }
      return false
    }

    if (isModified(body)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unmodified loop condition',
      `Condition variable${condVars.length > 1 ? 's' : ''} \`${condVars.join('`, `')}\` ${condVars.length > 1 ? 'are' : 'is'} never modified inside the loop body.`,
      sourceCode,
      'Modify the condition variable inside the loop or use a different loop structure.',
    )
  },
}
