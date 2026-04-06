import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects conditional expressions of the form `x if x > y else y` (manual min/max).
 * Also detects if-statement form: `if x > y: result = x\nelse: result = y`
 */
export const pythonIfExprMinMaxVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/if-expr-min-max',
  languages: ['python'],
  nodeTypes: ['conditional_expression'],
  visit(node, filePath, sourceCode) {
    // conditional_expression: <body> if <condition> else <alternative>
    // Check pattern: a if a > b else b  OR  b if a > b else a
    const children = node.namedChildren
    if (children.length !== 3) return null

    const [body, condition, alternative] = children

    // condition must be a comparison
    if (condition.type !== 'comparison_operator') return null

    const compLeft = condition.namedChildren[0]
    const compRight = condition.namedChildren[condition.namedChildren.length - 1]
    if (!compLeft || !compRight) return null

    const bodyText = body.text
    const altText = alternative.text
    const leftText = compLeft.text
    const rightText = compRight.text

    // a if a > b else b  => max(a, b)
    // a if a < b else b  => min(a, b)
    const isManualMinMax =
      (bodyText === leftText && altText === rightText) ||
      (bodyText === rightText && altText === leftText)

    if (!isManualMinMax) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Manual min/max with conditional expression',
      `This conditional expression manually computes a minimum or maximum. Use the \`min()\` or \`max()\` builtin instead.`,
      sourceCode,
      'Replace `x if x > y else y` with `max(x, y)` and `x if x < y else y` with `min(x, y)`.',
    )
  },
}
