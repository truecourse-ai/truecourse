import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const csharpIfWithSameArmsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/if-with-same-arms',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')
    if (!consequence || !alternative) return null

    // `else if` chains are dispatch, not a two-arm comparison.
    if (alternative.type === 'if_statement') return null

    if (consequence.text.trim() === alternative.text.trim()) {
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
