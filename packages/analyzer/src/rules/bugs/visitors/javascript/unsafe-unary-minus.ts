import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Unary minus on a non-numeric/non-bigint type.
 * Corresponds to @typescript-eslint/no-unsafe-unary-minus.
 */
export const unsafeUnaryMinusVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-unary-minus',
  languages: TS_LANGUAGES,
  nodeTypes: ['unary_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    // Check it's a unary minus
    const operator = node.children[0]
    if (!operator || operator.text !== '-') return null

    const operand = node.namedChildren[0]
    if (!operand) return null

    const typeStr = typeQuery.getTypeAtPosition(
      filePath,
      operand.startPosition.row,
      operand.startPosition.column,
    )
    if (!typeStr) return null

    // number, bigint, any, and literal number types are fine
    if (typeStr === 'number' || typeStr === 'bigint' || typeStr === 'any') return null
    if (/^\d+$/.test(typeStr)) return null // literal number type like '42'

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unsafe unary minus',
      `Unary minus applied to \`${typeStr}\` — only \`number\` and \`bigint\` support negation.`,
      sourceCode,
      'Convert to a number first or remove the unary minus.',
    )
  },
}
