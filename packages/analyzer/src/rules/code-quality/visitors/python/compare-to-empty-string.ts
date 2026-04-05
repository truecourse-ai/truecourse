import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function isEmptyString(node: SyntaxNode): boolean {
  if (node.type !== 'string') return false
  const text = node.text
  return text === '""' || text === "''" || text === '""""""' || text === "''''''";
}

export const pythonCompareToEmptyStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/compare-to-empty-string',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren
    if (children.length < 2) return null

    const left = children[0]
    const right = children[children.length - 1]

    if (isEmptyString(left) || isEmptyString(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Comparison to empty string',
        'Comparing to an empty string (`""`) is non-idiomatic. Use truthiness testing instead.',
        sourceCode,
        'Replace `x == ""` with `not x` and `x != ""` with `bool(x)` or just `x`.',
      )
    }

    return null
  },
}
