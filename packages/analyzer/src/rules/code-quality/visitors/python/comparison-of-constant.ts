import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

const LITERAL_TYPES = new Set([
  'integer', 'float', 'string', 'concatenated_string',
  'true', 'false', 'none',
])

function isLiteral(node: SyntaxNode): boolean {
  return LITERAL_TYPES.has(node.type)
}

export const pythonComparisonOfConstantVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/comparison-of-constant',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const left = node.namedChildren[0]
    const right = node.namedChildren[node.namedChildren.length - 1]
    if (!left || !right) return null

    if (isLiteral(left) && isLiteral(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Comparison of constants',
        `Both sides of the comparison are constant values. The result of this comparison is always the same and serves no purpose.`,
        sourceCode,
        'Remove or simplify this comparison — the condition is invariant.',
      )
    }

    return null
  },
}
