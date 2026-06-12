import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_LITERAL_TYPES } from './_helpers.js'

const COMPARISON_OPERATORS = new Set(['==', '!=', '<', '>', '<=', '>='])

function isLiteral(node: SyntaxNode): boolean {
  if (CSHARP_LITERAL_TYPES.has(node.type)) return true
  // Negative numeric literals: `-1`, `-2.5`.
  if (node.type === 'prefix_unary_expression' && node.text.startsWith('-')) {
    const operand = node.namedChildren[0]
    return operand?.type === 'integer_literal' || operand?.type === 'real_literal'
  }
  return false
}

export const csharpComparisonOfConstantVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/comparison-of-constant',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text
    if (!op || !COMPARISON_OPERATORS.has(op)) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    if (isLiteral(left) && isLiteral(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Comparison of constants',
        'Both sides of the comparison are constant values. The result of this comparison is always the same and serves no purpose.',
        sourceCode,
        'Remove or simplify this comparison — the condition is invariant.',
      )
    }

    return null
  },
}
