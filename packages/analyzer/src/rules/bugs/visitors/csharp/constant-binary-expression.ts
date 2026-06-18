import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isScalarLiteral } from './_helpers.js'

const COMPARISON_OPS = new Set(['==', '!=', '<', '>', '<=', '>='])

function isPlainLiteral(node: SyntaxNode): boolean {
  if (node.type === 'interpolated_string_expression') return false // holes are dynamic
  return isScalarLiteral(node)
}

/**
 * Binary expressions whose result never changes:
 *   - comparisons between two literals (`if (1 == 2)`)
 *   - `&&` / `||` with a boolean literal operand (`flag || true`)
 *   - ternaries with a literal condition (`true ? a : b`)
 *
 * Literal arithmetic (`24 * 60 * 60`) and literal string concatenation are
 * idiomatic compile-time constants and are NOT flagged.
 */
export const csharpConstantBinaryExpressionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constant-binary-expression',
  languages: ['csharp'],
  nodeTypes: ['binary_expression', 'conditional_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'conditional_expression') {
      const condition = node.childForFieldName('condition')
      if (condition?.type !== 'boolean_literal') return null
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Constant ternary expression',
        `\`${node.text}\` has a constant \`${condition.text}\` condition — the same branch is always taken.`,
        sourceCode,
        'Replace with the branch that is always taken.',
      )
    }

    const operator = node.childForFieldName('operator')?.text ?? ''
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    if (COMPARISON_OPS.has(operator) && isPlainLiteral(left) && isPlainLiteral(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Constant binary expression',
        `\`${node.text}\` compares two literals — the result is always the same.`,
        sourceCode,
        'Replace with the computed value or fix the operands.',
      )
    }

    if ((operator === '&&' || operator === '||') &&
        (left.type === 'boolean_literal' || right.type === 'boolean_literal')) {
      const literal = left.type === 'boolean_literal' ? left : right
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Constant binary expression',
        `\`${node.text}\` — the \`${literal.text}\` operand makes the \`${operator}\` expression ${(operator === '&&') === (literal.text === 'true') ? 'redundant' : 'constant'}.`,
        sourceCode,
        'Remove the literal operand or fix the condition.',
      )
    }

    return null
  },
}
