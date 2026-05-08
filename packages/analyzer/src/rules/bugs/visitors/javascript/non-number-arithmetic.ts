import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

const ARITHMETIC_OPS = new Set(['-', '*', '/', '%', '**'])

/**
 * Detect: Arithmetic operator used with non-numeric operands.
 * Corresponds to sonarjs S3760 (non-number-in-arithmetic-expression).
 */
export const nonNumberArithmeticVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/non-number-arithmetic',
  languages: TS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const operator = node.children.find(c => ARITHMETIC_OPS.has(c.text))
    if (!operator) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const leftType = typeQuery.getTypeAtPosition(filePath, left.startPosition.row, left.startPosition.column, left.endPosition.row, left.endPosition.column)
    const rightType = typeQuery.getTypeAtPosition(filePath, right.startPosition.row, right.startPosition.column, right.endPosition.row, right.endPosition.column)
    if (!leftType || !rightType) return null

    const numericTypes = new Set(['number', 'bigint', 'any'])
    // Numeric-literal types in TypeScript are reported as the value itself —
    // `19.125`, `-1`, `1e10`, `0xff`. Accept all of these as numeric, not
    // just integer literals.
    const NUMERIC_LITERAL_RE = /^-?(?:\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+)n?$/
    const leftOk = numericTypes.has(leftType) || NUMERIC_LITERAL_RE.test(leftType)
    const rightOk = numericTypes.has(rightType) || NUMERIC_LITERAL_RE.test(rightType)

    // Skip if either operand is a numeric literal — it's definitely a number
    if (left.type === 'number' || right.type === 'number') return null

    // Skip when an operand is wrapped in \`?? <number>\` — the
    // nullish-coalesce supplies a numeric fallback, guaranteeing
    // numeric type at runtime regardless of TS's reported type.
    function isNumericNullishCoalesce(n: import('web-tree-sitter').Node): boolean {
      let inner = n
      if (inner.type === 'parenthesized_expression') inner = inner.namedChild(0) ?? inner
      if (inner.type !== 'binary_expression') return false
      const op = inner.children.find((c) => c.text === '??')
      if (!op) return false
      const rhs = inner.childForFieldName('right')
      if (rhs?.type === 'number') return true
      if (rhs?.type === 'unary_expression' && rhs.namedChildren[0]?.type === 'number') return true
      return false
    }
    if (isNumericNullishCoalesce(left) || isNumericNullishCoalesce(right)) return null

    if (!leftOk || !rightOk) {
      const badSide = !leftOk ? `left operand is \`${leftType}\`` : `right operand is \`${rightType}\``
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Non-numeric value in arithmetic',
        `Arithmetic operator \`${operator.text}\` used with non-numeric operand — ${badSide}. This will produce \`NaN\` at runtime.`,
        sourceCode,
        'Convert operands to numbers or fix the expression.',
      )
    }

    return null
  },
}
