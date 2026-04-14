import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonLiteralMembershipTestVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/literal-membership-test',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    // Check for: x in [1, 2, 3]
    const children = node.children
    const inIdx = children.findIndex((c) => c.text === 'in' && !c.isNamed)
    if (inIdx === -1) return null

    const right = node.namedChildren[node.namedChildren.length - 1]
    if (!right) return null

    if (right.type === 'list') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Membership test on list literal',
        '`x in [1, 2, 3]` uses a list for membership testing, which is O(n). Use a set literal `{1, 2, 3}` for O(1) average-case lookup.',
        sourceCode,
        'Replace `x in [...]` with `x in {...}` to use a set for faster membership testing.',
      )
    }

    return null
  },
}
