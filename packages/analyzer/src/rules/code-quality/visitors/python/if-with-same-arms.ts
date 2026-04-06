import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonIfWithSameArmsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/if-with-same-arms',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const alternative = node.namedChildren.find((c) => c.type === 'else_clause')
    if (!alternative) return null

    const hasElif = node.namedChildren.some((c) => c.type === 'elif_clause')
    if (hasElif) return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null
    const elseBody = alternative.namedChildren.find((c) => c.type === 'block')
    if (!elseBody) return null

    // Compare the bodies by text content
    if (consequence.text.trim() === elseBody.text.trim()) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'if/else with identical bodies',
        'Both `if` and `else` branches have identical code — the condition has no effect.',
        sourceCode,
        'Remove the if/else and keep only one copy of the code, or fix the logic so the branches differ.',
      )
    }
    return null
  },
}
