import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAllBranchesIdenticalVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/all-branches-identical',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')

    if (!consequence || !alternative) return null

    // The alternative is an else_clause; get the body block
    let altBody = alternative
    if (alternative.type === 'else_clause') {
      const block = alternative.namedChildren.find((c) => c.type === 'block')
      if (block) altBody = block
    }

    if (consequence.text.trim() === altBody.text.trim()) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'All branches identical',
        'The if and else branches contain identical code — the condition has no effect.',
        sourceCode,
        'Remove the condition and keep only the body, or fix the branches to differ.',
      )
    }
    return null
  },
}
