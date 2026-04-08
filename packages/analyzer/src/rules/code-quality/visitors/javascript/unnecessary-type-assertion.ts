import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Type assertion that does not change the expression type.
 * Corresponds to @typescript-eslint/no-unnecessary-type-assertion.
 */
export const unnecessaryTypeAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-type-assertion',
  languages: TS_LANGUAGES,
  nodeTypes: ['as_expression', 'non_null_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    if (node.type === 'non_null_expression') {
      // x! when x is already non-nullable
      const expr = node.namedChildren[0]
      if (!expr) return null

      // process.env.* is always potentially undefined at runtime regardless of TS types
      if (expr.text.startsWith('process.env.')) return null

      const typeStr = typeQuery.getTypeAtPosition(
        filePath,
        expr.startPosition.row,
        expr.startPosition.column,
      )
      if (!typeStr) return null

      // If the type doesn't include null or undefined, the ! is unnecessary
      if (!typeStr.includes('null') && !typeStr.includes('undefined') && typeStr !== 'any') {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary non-null assertion',
          `Non-null assertion \`!\` on \`${expr.text}\` which is already typed as \`${typeStr}\` — it cannot be null or undefined.`,
          sourceCode,
          'Remove the non-null assertion operator `!`.',
        )
      }
    }

    if (node.type === 'as_expression') {
      const expr = node.namedChildren[0]
      const typeAnnotation = node.namedChildren[1]
      if (!expr || !typeAnnotation) return null

      const exprType = typeQuery.getTypeAtPosition(
        filePath,
        expr.startPosition.row,
        expr.startPosition.column,
      )
      const targetType = typeQuery.getTypeAtPosition(
        filePath,
        typeAnnotation.startPosition.row,
        typeAnnotation.startPosition.column,
      )

      if (exprType && targetType && exprType === targetType) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary type assertion',
          `Type assertion \`as ${typeAnnotation.text}\` is unnecessary — the expression is already of type \`${exprType}\`.`,
          sourceCode,
          'Remove the `as` type assertion.',
        )
      }
    }

    return null
  },
}
