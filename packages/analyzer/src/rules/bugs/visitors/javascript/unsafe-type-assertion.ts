import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Type assertion (`as Type`) that unsafely narrows a type, hiding type errors.
 * Corresponds to @typescript-eslint/no-unsafe-type-assertion.
 *
 * Flags assertions where the source and target types are incompatible
 * (not assignable in either direction).
 */
export const unsafeTypeAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-type-assertion',
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
    if (!exprType) return null

    // Skip: asserting from any/unknown is expected pattern
    if (exprType === 'any' || exprType === 'unknown') return null

    // Check compatibility between source and target
    const compatible = typeQuery.areTypesCompatible(
      filePath,
      expr.startPosition.row, expr.startPosition.column,
      typeAnnotation.startPosition.row, typeAnnotation.startPosition.column,
    )

    if (!compatible) {
      const targetType = typeQuery.getTypeAtPosition(
        filePath,
        typeAnnotation.startPosition.row,
        typeAnnotation.startPosition.column,
      )
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Unsafe type assertion',
        `Type assertion from \`${exprType}\` to \`${targetType ?? 'unknown'}\` — these types are not compatible. This hides a potential type error.`,
        sourceCode,
        'Fix the type mismatch instead of using a type assertion, or use `as unknown as T` if intentional.',
      )
    }

    return null
  },
}
