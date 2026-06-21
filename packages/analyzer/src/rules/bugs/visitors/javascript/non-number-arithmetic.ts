import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

const ARITHMETIC_OPS = new Set(['-', '*', '/', '%', '**'])

// Types that confidently produce NaN under arithmetic. Anything else — a
// user-defined type name, an unresolved import, a complex union — is treated
// as "uncertain, don't fire." This is intentionally fail-open: when the
// target's node_modules isn't installed, `getTypeAtPosition` often returns
// the parent type name (`PageRenderData`) instead of the resolved field type
// (`number`), which slipped through the old "anything not in {number,
// bigint, any}" gate and fired spuriously on every well-typed expression.
const CONFIDENTLY_NON_NUMERIC = new Set([
  'string',
  'boolean',
  'null',
  'undefined',
  'void',
  'symbol',
  'never',
  'object',
  // Common runtime types that don't auto-coerce to number in arithmetic.
  'Date',
])

function isConfidentlyNonNumeric(t: string): boolean {
  if (CONFIDENTLY_NON_NUMERIC.has(t)) return true
  // String literal types: `"foo"`, `'bar'`.
  if (/^["']/.test(t)) return true
  // Boolean literal types.
  if (t === 'true' || t === 'false') return true
  // Array / readonly array of anything: `string[]`, `T[]`, `readonly string[]`.
  if (/\[\]$/.test(t) || /^readonly\s/.test(t)) return true
  // Function / object literal types: `(...) => ...`, `{ ... }`.
  if (t.includes('=>') || t.startsWith('{')) return true
  return false
}

/**
 * Detect: Arithmetic operator used with non-numeric operands.
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

    // Skip if either operand is a numeric literal — it's definitely a number
    if (left.type === 'number' || right.type === 'number') return null

    const leftBad = isConfidentlyNonNumeric(leftType)
    const rightBad = isConfidentlyNonNumeric(rightType)
    if (!leftBad && !rightBad) return null

    const badSide = leftBad ? `left operand is \`${leftType}\`` : `right operand is \`${rightType}\``
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Non-numeric value in arithmetic',
      `Arithmetic operator \`${operator.text}\` used with non-numeric operand — ${badSide}. This will produce \`NaN\` at runtime.`,
      sourceCode,
      'Convert operands to numbers or fix the expression.',
    )
  },
}
