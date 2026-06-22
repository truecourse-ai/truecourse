import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** `String.Compare(...)` / `string.Compare(...)` invocation, or null. */
function isStringCompareCall(node: SyntaxNode): boolean {
  if (node.type !== 'invocation_expression') return false
  const fn = node.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return false
  const recv = fn.childForFieldName('expression')?.text
  return (recv === 'String' || recv === 'string') && fn.childForFieldName('name')?.text === 'Compare'
}

/**
 * `String.Compare(a, b) == 0` tests equality the long way round: `Compare`
 * returns a sign, and comparing it to zero to mean "equal" is less direct and
 * usually slower than `String.Equals(a, b)` (CA2251). Matched on a `==`/`!=`
 * with a `String.Compare(...)` call on one side and the literal `0` on the
 * other; ordering comparisons (`< 0`, `> 0`) genuinely need the sign and are
 * left alone.
 */
export const csharpStringCompareToZeroVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/string-compare-to-zero',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text
    if (op !== '==' && op !== '!=') return null
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const compareSide =
      isStringCompareCall(left) ? left : isStringCompareCall(right) ? right : null
    if (!compareSide) return null
    const zeroSide = compareSide.id === left.id ? right : left
    if (zeroSide.type !== 'integer_literal' || zeroSide.text !== '0') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'String.Compare compared to zero',
      '`String.Compare(...) == 0` tests equality indirectly — `String.Equals(a, b)` is clearer and usually faster (CA2251).',
      sourceCode,
      'Use `String.Equals(a, b)` (negate for `!= 0`).',
    )
  },
}
