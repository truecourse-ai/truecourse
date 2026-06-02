import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Unary minus on a non-numeric/non-bigint type.
 * Corresponds to @typescript-eslint/no-unsafe-unary-minus.
 */
export const unsafeUnaryMinusVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-unary-minus',
  languages: TS_LANGUAGES,
  nodeTypes: ['unary_expression'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    // Check it's a unary minus
    const operator = node.children[0]
    if (!operator || operator.text !== '-') return null

    const operand = node.namedChildren[0]
    if (!operand) return null

    // Span-aware query: without the end position, smallest-node lookup can
    // land on a sub-node (e.g. the `new` keyword inside `new Date()`) whose
    // type isn't the expression's result type.
    const typeStr = typeQuery.getTypeAtPosition(
      filePath,
      operand.startPosition.row,
      operand.startPosition.column,
      operand.endPosition.row,
      operand.endPosition.column,
    )
    if (!typeStr) return null

    if (isNumericOrBigintType(typeStr)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unsafe unary minus',
      `Unary minus applied to \`${typeStr}\` — only \`number\` and \`bigint\` support negation.`,
      sourceCode,
      'Convert to a number first or remove the unary minus.',
    )
  },
}

// Numeric/bigint primitives, their literal types, and unions of those. The
// compiler serializes literals as `1`, `-1`, `1.5`, `-9223372036854775808n`
// etc. — accept any of those shapes (including unions like `1.5 | -1.5`).
function isNumericOrBigintType(typeStr: string): boolean {
  const parts = typeStr.split(/\s*\|\s*/)
  return parts.every(isNumericOrBigintAtom)
}

function isNumericOrBigintAtom(part: string): boolean {
  const t = part.trim()
  if (t === 'number' || t === 'bigint' || t === 'any' || t === 'never') return true
  if (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(t)) return true // number literal
  if (/^-?\d+n$/.test(t)) return true // bigint literal
  return false
}
