import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonContradictoryBooleanExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/contradictory-boolean-expression',
  languages: ['python'],
  nodeTypes: ['boolean_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren
    if (children.length < 2) return null

    const andOp = node.children.find((c) => c.type === 'and')
    const orOp = node.children.find((c) => c.type === 'or')

    const operands = children.map((c) => c.text)

    // x and not x → always False
    // x or not x → always True
    for (let i = 0; i < operands.length; i++) {
      const op = operands[i]
      for (let j = 0; j < operands.length; j++) {
        if (i === j) continue
        const other = operands[j]
        if (other === `not ${op}` || `not ${other}` === op) {
          if (andOp) {
            return makeViolation(
              this.ruleKey, node, filePath, 'medium',
              'Contradictory boolean expression',
              `\`${node.text}\` is always \`False\` — \`${op} and not ${op}\` is a contradiction.`,
              sourceCode,
              'Remove the contradiction — this condition is always False.',
            )
          }
          if (orOp) {
            return makeViolation(
              this.ruleKey, node, filePath, 'medium',
              'Tautological boolean expression',
              `\`${node.text}\` is always \`True\` — \`${op} or not ${op}\` is a tautology.`,
              sourceCode,
              'Remove the tautology — this condition is always True.',
            )
          }
        }
      }
    }

    // x and False → always False
    // x or True → always True
    if (andOp) {
      if (operands.includes('False')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Contradictory boolean expression',
          `\`${node.text}\` is always \`False\` — anything \`and False\` is False.`,
          sourceCode,
          'Replace the whole expression with `False`.',
        )
      }
    }
    if (orOp) {
      if (operands.includes('True')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Tautological boolean expression',
          `\`${node.text}\` is always \`True\` — anything \`or True\` is True.`,
          sourceCode,
          'Replace the whole expression with `True`.',
        )
      }
    }

    return null
  },
}
