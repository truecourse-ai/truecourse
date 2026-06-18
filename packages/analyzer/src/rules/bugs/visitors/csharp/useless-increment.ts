import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `x = x++` — the post-increment's ORIGINAL value is assigned back after
 * the increment, so x is left unchanged. The increment has no effect.
 */
export const csharpUselessIncrementVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-increment',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('operator')?.text !== '=') return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || right?.type !== 'postfix_unary_expression') return null

    const op = right.children.find((c) => c?.type === '++' || c?.type === '--')
    const operand = right.namedChildren[0]
    if (!op || !operand || operand.text !== left.text) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Useless increment',
      `\`${node.text}\` assigns the pre-${op.type === '++' ? 'increment' : 'decrement'} value back to \`${left.text}\` — the variable is left unchanged and the \`${op.type}\` has no effect.`,
      sourceCode,
      `Use \`${left.text}${op.type}\` on its own, without the assignment.`,
    )
  },
}
