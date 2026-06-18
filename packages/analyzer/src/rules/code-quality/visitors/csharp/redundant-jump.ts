import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isCSharpFunctionBoundary } from './_helpers.js'

const LOOP_TYPES = new Set(['for_statement', 'foreach_statement', 'while_statement', 'do_statement'])

export const csharpRedundantJumpVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-jump',
  languages: ['csharp'],
  nodeTypes: ['return_statement', 'continue_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'block') return null
    const stmts = parent.namedChildren
    if (stmts[stmts.length - 1]?.id !== node.id) return null
    const grandparent = parent.parent
    if (!grandparent) return null

    if (node.type === 'return_statement') {
      if (node.namedChildren.length > 0) return null
      if (!isCSharpFunctionBoundary(grandparent.type)) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Redundant return',
        '`return;` at the end of a void method is unnecessary.',
        sourceCode,
        'Remove the redundant return statement.',
      )
    }

    // `continue` inside an if/switch within the loop is NOT redundant — only
    // a trailing continue of the loop body itself.
    if (!LOOP_TYPES.has(grandparent.type)) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant continue',
      '`continue;` at the end of a loop body is unnecessary.',
      sourceCode,
      'Remove the redundant continue statement.',
    )
  },
}
