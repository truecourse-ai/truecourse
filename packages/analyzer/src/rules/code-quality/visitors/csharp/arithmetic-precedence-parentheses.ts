import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A multiplicative operator (`* / %`) and an additive/shift operator (`+ - <<
 * >>`) appearing in the same unparenthesized expression rely on precedence
 * that is easy to misread (`a + b * c`). Adding parentheses around the
 * higher-precedence group makes the grouping explicit.
 *
 * To yield a single finding per expression, the rule reports on the OUTERMOST
 * additive/shift node of a chain (its parent is not itself additive/shift) and
 * then scans the whole chain for any unparenthesized multiplicative operand.
 * Parenthesized operands are treated as already-clarified.
 */

const MULTIPLICATIVE = new Set(['*', '/', '%'])
const ADDITIVE_SHIFT = new Set(['+', '-', '<<', '>>'])

function tier(op: string): 'mul' | 'add' | null {
  if (MULTIPLICATIVE.has(op)) return 'mul'
  if (ADDITIVE_SHIFT.has(op)) return 'add'
  return null
}

function binaryOp(node: SyntaxNode): string | null {
  if (node.type !== 'binary_expression') return null
  return node.childForFieldName('operator')?.text ?? null
}

/**
 * Walk an additive/shift chain rooted at `node` and return the operator of the
 * first unparenthesized multiplicative operand found, or null. Operands that
 * are themselves additive/shift binaries continue the chain; parenthesized
 * operands stop it.
 */
function findMixedMul(node: SyntaxNode): string | null {
  for (const side of ['left', 'right'] as const) {
    const child = node.childForFieldName(side)
    if (!child || child.type === 'parenthesized_expression') continue
    const childOp = binaryOp(child)
    if (!childOp) continue
    const childTier = tier(childOp)
    if (childTier === 'mul') return childOp
    if (childTier === 'add') {
      const nested = findMixedMul(child)
      if (nested) return nested
    }
  }
  return null
}

export const csharpArithmeticPrecedenceParenthesesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/arithmetic-precedence-parentheses',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = binaryOp(node)
    if (!op || tier(op) !== 'add') return null

    // Report only on the outermost additive/shift node so an additive chain
    // (`a + b*c + d*e`) yields a single finding.
    const parentOp = node.parent ? binaryOp(node.parent) : null
    if (parentOp && tier(parentOp) === 'add') return null

    const mixedMul = findMixedMul(node)
    if (!mixedMul) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unclear arithmetic precedence',
      `\`${node.text}\` mixes \`${mixedMul}\` and \`${op}\` without parentheses; add parentheses to make the grouping explicit.`,
      sourceCode,
      'Wrap the higher-precedence sub-expression in parentheses, e.g. `a + (b * c)`.',
    )
  },
}
