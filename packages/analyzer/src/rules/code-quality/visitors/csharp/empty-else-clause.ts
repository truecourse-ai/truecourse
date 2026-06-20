import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An `else` branch with an empty body (`else { }`) adds nothing and only
 * clutters the control flow; the conditional reads more clearly with the dead
 * `else` removed. A body containing only comments is treated as intentional
 * (the author is documenting why nothing happens) and is left alone.
 */
export const csharpEmptyElseClauseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-else-clause',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const alternative = node.childForFieldName('alternative')
    if (!alternative || alternative.type !== 'block') return null
    // Comments are named children — a commented-out else is an intentional stub.
    if (alternative.namedChildCount > 0) return null

    return makeViolation(
      this.ruleKey, alternative, filePath, 'low',
      'Empty else clause',
      'This `else` branch has an empty body and adds nothing; remove it so the conditional reads cleanly.',
      sourceCode,
      'Delete the empty `else` clause.',
    )
  },
}
