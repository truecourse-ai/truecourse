import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects `++x` and `--x` patterns in Python.
 * These are no-ops (double unary plus/minus), not increment/decrement operators.
 * Python doesn't have ++ or -- operators.
 */
export const pythonUnaryPrefixIncrementDecrementVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unary-prefix-increment-decrement',
  languages: ['python'],
  nodeTypes: ['unary_operator'],
  visit(node, filePath, sourceCode) {
    const operator = node.children[0]
    if (!operator) return null

    const opText = operator.text

    // Check for double unary: +expr or -expr where expr is also unary +/-
    if (opText !== '+' && opText !== '-') return null

    const operand = node.namedChildren[0]
    if (!operand) return null

    if (operand.type !== 'unary_operator') return null

    const innerOp = operand.children[0]
    if (!innerOp) return null

    if (innerOp.text !== opText) return null

    const innerExpr = operand.namedChildren[0]
    if (!innerExpr) return null

    const symbol = opText === '+' ? '++' : '--'
    const varName = innerExpr.text

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      `Unary prefix ${symbol} is a no-op in Python`,
      `\`${symbol}${varName}\` in Python is not an increment/decrement — it is double unary ${opText === '+' ? 'plus' : 'minus'}, which is a no-op. Python has no \`++\`/\`--\` operators.`,
      sourceCode,
      `Replace \`${symbol}${varName}\` with \`${varName} ${opText}= 1\` (i.e., \`${varName} ${opText}= 1\`).`,
    )
  },
}
