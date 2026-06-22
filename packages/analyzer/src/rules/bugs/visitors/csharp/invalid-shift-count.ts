import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A bit-shift (`<<` / `>>` / `>>>`) by a literal count of `0`. Shifting by zero
 * is a no-op that returns the value unchanged — the shift has no effect, which
 * is almost always a leftover or a mistaken count. (Shifts by a count at or
 * above the operand's bit width depend on the operand type and are left to a
 * type-aware analyzer; only the unambiguous literal-zero case is reported.)
 */
export const csharpInvalidShiftCountVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-shift-count',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text
    if (op !== '<<' && op !== '>>' && op !== '>>>') return null

    const right = node.childForFieldName('right')
    if (right?.type !== 'integer_literal') return null
    if (right.text.replace(/_/g, '').replace(/[uUlL]+$/, '') !== '0') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Shift by zero',
      'Shifting by a count of 0 is a no-op that returns the value unchanged — the shift has no effect.',
      sourceCode,
      'Remove the no-op shift, or use the intended non-zero count.',
    )
  },
}
