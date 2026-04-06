import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const allBranchesIdenticalVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/all-branches-identical',
  languages: JS_LANGUAGES,
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')

    if (!consequence || !alternative) return null

    // Get the actual body text. For else_clause, get the inner statement block.
    let altBody = alternative
    if (alternative.type === 'else_clause') {
      const inner = alternative.namedChildren[0]
      if (inner) altBody = inner
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
