import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryPassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-pass',
  languages: ['python'],
  nodeTypes: ['pass_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'block') return null

    // If the block has more than just the pass statement, it's unnecessary
    const siblings = parent.namedChildren.filter((c) => c.type !== 'comment')
    if (siblings.length <= 1) return null // Only pass — potentially needed

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary pass statement',
      '`pass` in a block that already has other statements is redundant.',
      sourceCode,
      'Remove the redundant `pass` statement.',
    )
  },
}
