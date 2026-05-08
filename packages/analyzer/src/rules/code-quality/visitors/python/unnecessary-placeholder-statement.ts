import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryPlaceholderStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-placeholder-statement',
  languages: ['python'],
  nodeTypes: ['pass_statement', 'expression_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'pass_statement') {
      // pass is only needed when a block would otherwise be empty
      const parent = node.parent
      if (!parent || parent.type !== 'block') return null

      // Skip docstring-only abstract-method-stub pattern:
      //   def get(...) -> X:
      //       """docstring."""
      //       pass
      // The pass is conventional for "explicitly empty body" alongside
      // the contract docstring. Python permits docstring-only bodies but
      // the explicit pass reads as deliberate "no implementation here".
      const grandparent = parent.parent
      if (grandparent?.type === 'function_definition') {
        const siblings = parent.namedChildren.filter((c) => c.type !== 'comment')
        const hasDocstring = siblings.some((c) => {
          if (c.type === 'expression_statement') {
            const inner = c.namedChildren[0]
            return inner?.type === 'string'
          }
          return false
        })
        if (hasDocstring && siblings.length === 2) return null
      }

      // Count non-pass, non-comment statements in the block. A
      // comment alone alongside `pass` is still an empty body —
      // removing the pass would leave only a comment, which is
      // not an executable statement. Common in except / elif /
      // case bodies where a trailing comment explains why the
      // branch is intentionally a no-op.
      const nonPass = parent.namedChildren.filter(
        (c) => c.type !== 'pass_statement' && c.type !== 'comment',
      )
      if (nonPass.length > 0) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary pass statement',
          '`pass` is redundant in a block that already has statements.',
          sourceCode,
          'Remove the `pass` statement.',
        )
      }
      return null
    }

    if (node.type === 'expression_statement') {
      // ... (ellipsis) as placeholder
      const expr = node.namedChildren[0]
      if (!expr || expr.type !== 'ellipsis') return null

      const parent = node.parent
      if (!parent || parent.type !== 'block') return null

      // Check if the block has other statements
      const otherStmts = parent.namedChildren.filter((c) => {
        if (c.id === node.id) return false
        // Skip docstrings
        if (c.type === 'expression_statement') {
          const inner = c.namedChildren[0]
          return inner?.type !== 'string'
        }
        return true
      })

      if (otherStmts.length > 0) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary ellipsis placeholder',
          '`...` is redundant in a block that already has statements.',
          sourceCode,
          'Remove the `...` placeholder.',
        )
      }
    }

    return null
  },
}
