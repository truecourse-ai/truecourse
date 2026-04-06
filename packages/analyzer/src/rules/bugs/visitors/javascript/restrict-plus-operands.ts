import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Addition operands of different types (string + number, etc.).
 * Corresponds to @typescript-eslint/restrict-plus-operands.
 */
export const restrictPlusOperandsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/restrict-plus-operands',
  languages: TS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const operator = node.children.find(c => c.type === '+' || c.text === '+')
    if (!operator || operator.text !== '+') return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const leftType = typeQuery.getTypeAtPosition(filePath, left.startPosition.row, left.startPosition.column)
    const rightType = typeQuery.getTypeAtPosition(filePath, right.startPosition.row, right.startPosition.column)
    if (!leftType || !rightType) return null

    // Allow: both string, both number, both bigint, both any
    if (leftType === rightType) return null
    if (leftType === 'any' || rightType === 'any') return null

    const isLeftNumeric = leftType === 'number' || leftType === 'bigint'
    const isRightNumeric = rightType === 'number' || rightType === 'bigint'
    const isLeftString = leftType === 'string'
    const isRightString = rightType === 'string'

    // Mixed: number + string, bigint + number, etc.
    if ((isLeftNumeric && isRightString) || (isLeftString && isRightNumeric) || (leftType === 'bigint' && rightType === 'number') || (leftType === 'number' && rightType === 'bigint')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Mismatched addition operands',
        `Addition with mismatched types: \`${leftType}\` + \`${rightType}\`. Both operands should be the same type.`,
        sourceCode,
        'Convert operands to the same type before adding, e.g., `String(n) + s` or `n + Number(s)`.',
      )
    }

    return null
  },
}
