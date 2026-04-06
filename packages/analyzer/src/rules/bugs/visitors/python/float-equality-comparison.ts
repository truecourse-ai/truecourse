import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonFloatEqualityComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/float-equality-comparison',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    const eqOp = children.find((c) => c.text === '==' || c.text === '!=')
    if (!eqOp) return null

    for (const child of node.namedChildren) {
      if (child.type === 'float') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Float equality comparison',
          `Comparing a float (\`${child.text}\`) with \`${eqOp.text}\` is unreliable due to floating-point representation issues.`,
          sourceCode,
          'Use `math.isclose(a, b)` for float comparisons instead of `==`.',
        )
      }
    }

    return null
  },
}
