import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Type assertion that does not change the expression type.
 * Corresponds to @typescript-eslint/no-unnecessary-type-assertion.
 *
 * Non-null assertions (x!) are NOT flagged — TypeQuery resolves narrowed types
 * that may drop null/undefined, but the declared type genuinely allows it.
 * Common FP patterns: optional properties, Map.get(), variables narrowed by
 * control flow but used inside closures where TS can't track narrowing.
 */
export const unnecessaryTypeAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-type-assertion',
  languages: TS_LANGUAGES,
  nodeTypes: ['as_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

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

    // Skip when source type is `any` — narrowing from any is a meaningful assertion
    if (exprType === 'any') return null

    if (exprType && targetType && exprType === targetType) {
      // Skip narrowing via keyof — `key as keyof T` provides a useful type constraint
      // even when TS resolves both sides to the same type (e.g. string)
      if (typeAnnotation.text.includes('keyof')) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Unnecessary type assertion',
        `Type assertion \`as ${typeAnnotation.text}\` is unnecessary — the expression is already of type \`${exprType}\`.`,
        sourceCode,
        'Remove the `as` type assertion.',
      )
    }

    return null
  },
}
