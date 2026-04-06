import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Spreading a value that shouldn't be spread (e.g., string into array, number).
 * Corresponds to @typescript-eslint/no-misused-spread.
 */
export const misusedSpreadVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/misused-spread',
  languages: TS_LANGUAGES,
  nodeTypes: ['spread_element'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null
    const spreadArg = node.namedChildren[0]
    if (!spreadArg) return null

    const typeStr = typeQuery.getTypeAtPosition(
      filePath,
      spreadArg.startPosition.row,
      spreadArg.startPosition.column,
    )
    if (!typeStr) return null

    // Spreading a string into an array yields individual characters — usually a bug
    if (typeStr === 'string') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Spreading a string into array',
        'Spreading a string creates an array of individual characters — this is usually unintentional.',
        sourceCode,
        'Wrap in an array `[value]` instead of spreading, or use `value.split()` if you need characters.',
      )
    }

    // Spreading a number/boolean/symbol makes no sense
    if (typeStr === 'number' || typeStr === 'boolean' || typeStr === 'symbol' || typeStr === 'bigint') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Spreading a non-iterable value',
        `Spreading a \`${typeStr}\` value — this type is not iterable and will cause a runtime error.`,
        sourceCode,
        'Remove the spread operator or use an iterable value.',
      )
    }

    return null
  },
}
