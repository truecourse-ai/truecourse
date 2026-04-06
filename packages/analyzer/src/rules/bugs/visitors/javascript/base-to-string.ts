import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Calling .toString() on an object that doesn't provide a useful string representation.
 * Corresponds to @typescript-eslint/no-base-to-string.
 */
export const baseToStringVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/base-to-string',
  languages: TS_LANGUAGES,
  nodeTypes: ['call_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || prop.text !== 'toString') return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null

    const typeStr = typeQuery.getTypeAtPosition(
      filePath,
      obj.startPosition.row,
      obj.startPosition.column,
    )
    if (!typeStr) return null

    // Primitives have useful toString
    const safeTypes = new Set(['string', 'number', 'boolean', 'bigint', 'symbol', 'any', 'unknown'])
    if (safeTypes.has(typeStr)) return null
    // String/number literal types are fine
    if (/^".*"$/.test(typeStr) || /^\d+$/.test(typeStr)) return null
    // RegExp has a useful toString
    if (typeStr === 'RegExp') return null
    // Date has a useful toString
    if (typeStr === 'Date') return null
    // Error has a useful toString
    if (typeStr.includes('Error')) return null

    // Plain objects produce "[object Object]"
    if (typeStr.startsWith('{') || typeStr === 'object') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Useless toString() call',
        `Calling \`.toString()\` on \`${typeStr}\` will produce \`[object Object]\` — this type does not provide a useful string representation.`,
        sourceCode,
        'Use `JSON.stringify()` or access specific properties instead.',
      )
    }

    return null
  },
}
