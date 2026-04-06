import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSelfComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-comparison',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren
    if (children.length !== 2) return null

    const left = children[0]
    const right = children[1]

    if (left.text === right.text && left.type === right.type) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Self comparison',
        `Comparing \`${left.text}\` to itself is likely a bug.`,
        sourceCode,
        'Compare against a different value, or remove this comparison.',
      )
    }
    return null
  },
}
