import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonMultipleWithStatementsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/multiple-with-statements',
  languages: ['python'],
  nodeTypes: ['with_statement'],
  visit(node, filePath, sourceCode) {
    // Check if parent is a with_statement's body
    const parent = node.parent
    if (!parent) return null

    // Look for nested with at the single-statement level
    const isInsideWith = parent.type === 'block' && parent.parent?.type === 'with_statement'
    if (!isInsideWith) return null

    // Only flag if this is the only statement in the parent with's body
    const siblings = parent.namedChildren
    if (siblings.length !== 1) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Multiple nested with statements',
      'Nested `with` statements can be combined: `with ctx1, ctx2:`.',
      sourceCode,
      'Combine into a single `with` statement: `with ctx1, ctx2:`.',
    )
  },
}
