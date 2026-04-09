import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES } from './_helpers.js'

export const redundantJumpVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-jump',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['return_statement', 'continue_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'return_statement') {
      if (node.namedChildren.length > 0) return null
      const parent = node.parent
      if (!parent) return null
      const stmts = parent.namedChildren
      if (stmts[stmts.length - 1]?.id !== node.id) return null
      const grandparent = parent.parent
      if (!grandparent) return null
      if (!JS_FUNCTION_TYPES.includes(grandparent.type)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant return',
        'return at the end of a void function is unnecessary.',
        sourceCode,
        'Remove the redundant return statement.',
      )
    }

    if (node.type === 'continue_statement') {
      const parent = node.parent
      if (!parent) return null
      const stmts = parent.namedChildren
      if (stmts[stmts.length - 1]?.id !== node.id) return null

      // Only redundant if the parent block is the direct body of a loop.
      // `continue` inside an `if`/`else`/`switch` within a loop is NOT redundant.
      const grandparent = parent.parent
      if (!grandparent) return null
      const LOOP_TYPES = ['for_statement', 'for_in_statement', 'for_of_statement', 'while_statement', 'do_statement']
      if (!LOOP_TYPES.includes(grandparent.type)) return null

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
