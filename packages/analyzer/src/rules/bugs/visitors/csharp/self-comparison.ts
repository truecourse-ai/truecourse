import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '<=', '>', '>='])

/**
 * `x == x`, `total >= total`, … — comparing an expression to itself always
 * yields a constant (except for NaN, where `x != x` is still better written
 * as double.IsNaN). Operands containing calls are skipped: `Next() == Next()`
 * legitimately differs between invocations.
 */
export const csharpSelfComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-comparison',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.childForFieldName('operator')
    if (!left || !right || !operator) return null
    if (!COMPARISON_OPERATORS.has(operator.text)) return null

    if (left.text !== right.text || left.type !== right.type) return null
    if (left.text.includes('(')) return null // calls may return different values

    const alwaysFalse = operator.text === '!=' || operator.text === '>' || operator.text === '<'
    const isNanIdiom = operator.text === '==' || operator.text === '!='
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Self comparison',
      `Comparing \`${left.text}\` to itself is always ${alwaysFalse ? 'false' : 'true'} — likely a bug.${isNanIdiom ? ' If this is a NaN check, use double.IsNaN() instead.' : ''}`,
      sourceCode,
      'Compare against a different value, or use double.IsNaN() for NaN checks.',
    )
  },
}
