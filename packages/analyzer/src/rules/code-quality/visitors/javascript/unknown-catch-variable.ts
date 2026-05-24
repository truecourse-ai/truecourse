import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unknownCatchVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unknown-catch-variable',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['catch_clause'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    const param = node.childForFieldName('parameter')
    if (!param) return null

    const typeAnnotation = node.childForFieldName('type')
    if (typeAnnotation) return null

    // When tsconfig has `useUnknownInCatchVariables: true` (the default under
    // `strict: true`), the compiler already gives `e` the type `unknown`, so
    // the explicit annotation is redundant — flagging here is a false
    // positive. Only flag when the effective type is something else (i.e. the
    // tsconfig explicitly opts back into `any`).
    if (typeQuery) {
      const t = typeQuery.getTypeString(
        filePath,
        param.startPosition.row,
        param.startPosition.column,
        param.endPosition.row,
        param.endPosition.column,
      )
      if (t === 'unknown') return null
    }

    const paramName = param.text
    return makeViolation(
      this.ruleKey, param, filePath, 'low',
      'Untyped catch variable',
      `Catch variable \`${paramName}\` should be typed as \`unknown\` for type safety: \`catch (${paramName}: unknown)\`.`,
      sourceCode,
      `Add ': unknown' type annotation: \`catch (${paramName}: unknown)\`.`,
    )
  },
}
