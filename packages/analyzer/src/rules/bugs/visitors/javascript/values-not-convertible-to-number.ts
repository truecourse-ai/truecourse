import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

const RELATIONAL_OPS = new Set(['<', '>', '<=', '>='])

/**
 * Detect: Values not convertible to numbers used in numeric comparisons.
 * Corresponds to sonarjs S3758 (values-not-convertible-to-numbers).
 */
export const valuesNotConvertibleToNumberVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/values-not-convertible-to-number',
  languages: TS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const operator = node.children.find(c => RELATIONAL_OPS.has(c.text))
    if (!operator) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const leftType = typeQuery.getTypeAtPosition(filePath, left.startPosition.row, left.startPosition.column)
    const rightType = typeQuery.getTypeAtPosition(filePath, right.startPosition.row, right.startPosition.column)
    if (!leftType || !rightType) return null

    // Relational operators coerce to number. Objects, arrays, booleans are problematic.
    const nonComparableTypes = new Set(['boolean', 'object', 'void', 'undefined', 'null', 'never'])

    if (nonComparableTypes.has(leftType) || nonComparableTypes.has(rightType)) {
      const badType = nonComparableTypes.has(leftType) ? leftType : rightType
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Non-numeric comparison',
        `Relational comparison with \`${badType}\` — this type is not meaningfully convertible to a number, producing unreliable results.`,
        sourceCode,
        'Convert to a number explicitly or use a different comparison approach.',
      )
    }

    return null
  },
}
