import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function isSimpleComparison(node: SyntaxNode): { left: string; op: string; right: string } | null {
  if (node.type !== 'comparison_operator') return null
  const left = node.namedChildren[0]
  const right = node.namedChildren[node.namedChildren.length - 1]
  const opNode = node.children.find((c) => !c.isNamed)
  if (!left || !right || !opNode) return null
  return { left: left.text, op: opNode.text, right: right.text }
}

const ORDERING_OPS = new Set(['<', '<=', '>', '>='])

export const pythonBooleanChainedComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/boolean-chained-comparison',
  languages: ['python'],
  nodeTypes: ['boolean_operator'],
  visit(node, filePath, sourceCode) {
    // Only check `and` operators
    const hasAnd = node.children.some((c) => c.text === 'and')
    if (!hasAnd) return null

    const left = node.namedChildren[0]
    const right = node.namedChildren[1]
    if (!left || !right) return null

    const leftCmp = isSimpleComparison(left)
    const rightCmp = isSimpleComparison(right)
    if (!leftCmp || !rightCmp) return null

    if (!ORDERING_OPS.has(leftCmp.op) || !ORDERING_OPS.has(rightCmp.op)) return null

    // Check if middle value is the same: a < b and b < c
    if (leftCmp.right === rightCmp.left) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Boolean chained comparison',
        `\`${leftCmp.left} ${leftCmp.op} ${leftCmp.right} and ${rightCmp.left} ${rightCmp.op} ${rightCmp.right}\` can be simplified to a chained comparison.`,
        sourceCode,
        `Replace with \`${leftCmp.left} ${leftCmp.op} ${leftCmp.right} ${rightCmp.op} ${rightCmp.right}\` using Python\'s chained comparison syntax.`,
      )
    }

    return null
  },
}
