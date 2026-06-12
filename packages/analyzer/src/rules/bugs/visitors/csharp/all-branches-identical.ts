import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `if (cond) { X(); } else { X(); }` — both branches are identical, so the
 * condition has no effect. The alternative field in the C# grammar is the
 * else body directly (block or nested if), with no else_clause wrapper.
 */
export const csharpAllBranchesIdenticalVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/all-branches-identical',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')
    if (!consequence || !alternative) return null
    if (alternative.type === 'if_statement') return null

    if (consequence.text.trim() === alternative.text.trim()) {
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
