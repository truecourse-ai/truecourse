import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Comparing enum value with non-enum value.
 * Corresponds to @typescript-eslint/no-unsafe-enum-comparison.
 */
export const unsafeEnumComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-enum-comparison',
  languages: TS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const operator = node.children.find(c =>
      c.text === '===' || c.text === '==' || c.text === '!==' || c.text === '!=',
    )
    if (!operator) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const leftType = typeQuery.getTypeAtPosition(filePath, left.startPosition.row, left.startPosition.column)
    const rightType = typeQuery.getTypeAtPosition(filePath, right.startPosition.row, right.startPosition.column)
    if (!leftType || !rightType) return null

    // Check if one side is an enum and the other is a raw number/string
    const leftIsEnum = leftType.includes('.') && !leftType.startsWith('"') && !leftType.startsWith('\'')
    const rightIsEnum = rightType.includes('.') && !rightType.startsWith('"') && !rightType.startsWith('\'')

    if (leftIsEnum && !rightIsEnum && (rightType === 'number' || rightType === 'string')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unsafe enum comparison',
        `Comparing enum value (\`${leftType}\`) with a raw \`${rightType}\` — use the enum member instead.`,
        sourceCode,
        'Compare with the enum member (e.g., `MyEnum.Value`) instead of a literal.',
      )
    }

    if (rightIsEnum && !leftIsEnum && (leftType === 'number' || leftType === 'string')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Unsafe enum comparison',
        `Comparing raw \`${leftType}\` with enum value (\`${rightType}\`) — use the enum member instead.`,
        sourceCode,
        'Compare with the enum member (e.g., `MyEnum.Value`) instead of a literal.',
      )
    }

    return null
  },
}
