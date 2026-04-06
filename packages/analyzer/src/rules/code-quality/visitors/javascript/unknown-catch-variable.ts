import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unknownCatchVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unknown-catch-variable',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const param = node.childForFieldName('parameter')
    if (!param) return null

    const typeAnnotation = param.namedChildren.find((c) => c.type === 'type_annotation')
    if (typeAnnotation) return null

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
