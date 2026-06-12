import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `x == double.NaN` / `x != float.NaN` — NaN is never equal to anything,
 * including itself, so the comparison is constant. Use double.IsNaN(x).
 */
function isNaNLiteral(n: { type: string; text: string }): boolean {
  return n.type === 'member_access_expression' &&
    /^(System\.)?(double|float|Double|Single)\.NaN$/.test(n.text)
}

export const csharpNanComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/nan-comparison',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.childForFieldName('operator')
    if (!operator || (operator.text !== '==' && operator.text !== '!=')) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const nanSide = isNaNLiteral(left) ? left : isNaNLiteral(right) ? right : null
    if (!nanSide) return null
    const otherSide = nanSide === left ? right : left

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'NaN comparison',
      `\`${operator.text} ${nanSide.text}\` is always ${operator.text === '==' ? 'false' : 'true'} — NaN is never equal to itself. Use double.IsNaN() instead.`,
      sourceCode,
      `Replace with double.IsNaN(${otherSide.text}) (or float.IsNaN).`,
    )
  },
}
