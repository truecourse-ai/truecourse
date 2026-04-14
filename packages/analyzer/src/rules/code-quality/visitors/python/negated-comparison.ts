import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNegatedComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/negated-comparison',
  languages: ['python'],
  nodeTypes: ['not_operator'],
  visit(node, filePath, sourceCode) {
    // Detect: not (a == b) → a != b  or  not (a != b) → a == b
    const operand = node.namedChildren[0]
    if (!operand) return null

    // The operand might be a parenthesized expression
    let inner = operand
    if (inner.type === 'parenthesized_expression') {
      inner = inner.namedChildren[0] ?? inner
    }

    if (inner.type !== 'comparison_operator') return null

    // Look for == or != operator
    for (const child of inner.children) {
      if (child.type === '==' || child.type === '!=') {
        const simplified = child.type === '==' ? '!=' : '=='
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Negated comparison operator',
          `\`not (a ${child.type} b)\` should be written as \`a ${simplified} b\`.`,
          sourceCode,
          `Replace \`not (... ${child.type} ...)\` with \`... ${simplified} ...\`.`,
        )
      }
    }

    return null
  },
}
