import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * In C# the comparison/equality operators bind *tighter* than the bitwise
 * operators, so `flags & Mask == 0` parses as `flags & (Mask == 0)` — almost
 * never what the author meant. Mixing a bitwise operator (`& | ^`) with an
 * unparenthesized comparison operand is a precedence trap that explicit
 * parentheses resolve (RCS1123). The check fires on a `binary_expression` whose
 * operator is bitwise and one operand is an unparenthesized comparison.
 *
 * The "both operands are comparisons inside a condition" shape (`a == b & c == d`)
 * is owned by `bitwise-in-boolean` (a likely `&&`/`||` typo), so it is excluded
 * here to avoid double-reporting.
 */
const BITWISE = new Set(['&', '|', '^'])
const COMPARISON = new Set(['==', '!=', '<', '>', '<=', '>='])

function comparisonOperand(node: SyntaxNode | null): boolean {
  if (node?.type !== 'binary_expression') return false
  return COMPARISON.has(node.childForFieldName('operator')?.text ?? '')
}

export const csharpAddClarifyingParenthesesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/add-clarifying-parentheses',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    if (!BITWISE.has(node.childForFieldName('operator')?.text ?? '')) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const leftCmp = comparisonOperand(left)
    const rightCmp = comparisonOperand(right)
    if (!leftCmp && !rightCmp) return null
    // Both-comparisons shape belongs to bitwise-in-boolean.
    if (leftCmp && rightCmp) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Add parentheses to clarify operator precedence',
      `\`${node.text}\` mixes a bitwise operator with a comparison; the comparison binds tighter, so add parentheses to make the grouping explicit.`,
      sourceCode,
      'Wrap the intended sub-expression in parentheses, e.g. `(flags & Mask) == 0`.',
    )
  },
}
