import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

const SAFE_TEMPLATE_TYPES = new Set(['string', 'number', 'bigint', 'boolean', 'null', 'undefined', 'any'])

/**
 * Detect: Non-string value interpolated in template literal without useful toString.
 * Corresponds to @typescript-eslint/restrict-template-expressions.
 */
export const restrictTemplateExpressionsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/restrict-template-expressions',
  languages: TS_LANGUAGES,
  nodeTypes: ['template_substitution'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null
    const expr = node.namedChildren[0]
    if (!expr) return null

    const typeStr = typeQuery.getTypeAtPosition(
      filePath,
      expr.startPosition.row,
      expr.startPosition.column,
      expr.endPosition.row,
      expr.endPosition.column,
    )
    if (!typeStr) return null

    // Safe primitive types are fine in templates
    if (SAFE_TEMPLATE_TYPES.has(typeStr)) return null
    // Allow literal types like '"hello"' or '42'
    if (/^".*"$/.test(typeStr) || /^\d+$/.test(typeStr)) return null

    // Objects without custom toString will produce "[object Object]"
    if (typeStr.startsWith('{') || typeStr.includes('[]') || typeStr === 'object') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Object in template literal',
        `Value of type \`${typeStr}\` interpolated in template literal — will produce \`[object Object]\` unless it has a custom \`toString()\`.`,
        sourceCode,
        'Convert to a string explicitly, e.g., `JSON.stringify(value)` or access specific properties.',
      )
    }

    return null
  },
}
