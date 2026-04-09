import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonRedundantJumpVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-jump',
  languages: ['python'],
  nodeTypes: ['return_statement', 'continue_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'return_statement') {
      // return with a value is not redundant
      if (node.namedChildren.length > 0) return null
      const parent = node.parent
      if (!parent || parent.type !== 'block') return null
      const stmts = parent.namedChildren
      if (stmts[stmts.length - 1]?.id !== node.id) return null
      // parent.parent should be a function_definition
      const grandparent = parent.parent
      if (!grandparent || grandparent.type !== 'function_definition') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant return',
        'return at the end of a function with no value is unnecessary.',
        sourceCode,
        'Remove the redundant return statement.',
      )
    }

    if (node.type === 'continue_statement') {
      const parent = node.parent
      if (!parent || parent.type !== 'block') return null
      const stmts = parent.namedChildren
      if (stmts[stmts.length - 1]?.id !== node.id) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant continue',
        'continue at the end of a loop body is unnecessary.',
        sourceCode,
        'Remove the redundant continue statement.',
      )
    }

    return null
  },
}
