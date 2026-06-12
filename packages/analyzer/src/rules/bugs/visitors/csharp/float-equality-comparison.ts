import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `==` / `!=` against a floating-point literal (`0.1`, `2.5f`, `1e-3`) —
 * unreliable because of binary floating-point representation. Comparisons
 * against `0.0` are skipped: exact-zero sentinel checks are common and
 * well-defined for values that were assigned literally.
 */
export const csharpFloatEqualityComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/float-equality-comparison',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const operator = node.childForFieldName('operator')
    if (!operator || (operator.text !== '==' && operator.text !== '!=')) return null

    for (const side of [node.childForFieldName('left'), node.childForFieldName('right')]) {
      if (!side || side.type !== 'real_literal') continue
      if (/^0*\.?0*[fdm]?$/i.test(side.text.replace(/_/g, ''))) continue // 0.0 / .0 sentinel checks
      if (/m$/i.test(side.text)) continue // decimal literals compare exactly

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Float equality comparison',
        `Comparing a floating-point value with \`${operator.text} ${side.text}\` is unreliable due to binary representation error.`,
        sourceCode,
        'Compare with a tolerance: `Math.Abs(a - b) < epsilon`, or use `decimal` for exact arithmetic.',
      )
    }
    return null
  },
}
