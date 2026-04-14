import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function getEqualityComparison(node: SyntaxNode): { obj: string; value: string } | null {
  if (node.type !== 'comparison_operator') return null
  const children = node.namedChildren
  if (children.length < 2) return null
  // Find == operator
  const eqOp = node.children.find((c) => c.type === '==' || c.text === '==')
  if (!eqOp) return null
  return { obj: children[0].text, value: children[children.length - 1].text }
}

export const pythonCompareWithTupleVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/compare-with-tuple',
  languages: ['python'],
  nodeTypes: ['boolean_operator'],
  visit(node, filePath, sourceCode) {
    // Check for: x == 1 or x == 2 pattern
    const orOp = node.children.find((c) => c.type === 'or')
    if (!orOp) return null

    const comparisons: Array<{ obj: string; value: string }> = []

    function collect(n: SyntaxNode): void {
      if (n.type === 'comparison_operator') {
        const result = getEqualityComparison(n)
        if (result) comparisons.push(result)
        return
      }
      if (n.type === 'boolean_operator') {
        const op = n.children.find((c) => c.type === 'or')
        if (op) {
          for (let i = 0; i < n.childCount; i++) {
            const child = n.child(i)
            if (child) collect(child)
          }
        }
      }
    }

    collect(node)
    if (comparisons.length < 2) return null

    // Check same object in all comparisons
    const firstObj = comparisons[0].obj
    if (!comparisons.every((c) => c.obj === firstObj)) return null

    const values = comparisons.map((c) => c.value).join(', ')
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Multiple or-comparisons with same variable',
      `\`${comparisons.map((c) => `${c.obj} == ${c.value}`).join(' or ')}\` can be simplified to \`${firstObj} in (${values})\`.`,
      sourceCode,
      `Replace with \`${firstObj} in (${values})\` for clarity.`,
    )
  },
}
