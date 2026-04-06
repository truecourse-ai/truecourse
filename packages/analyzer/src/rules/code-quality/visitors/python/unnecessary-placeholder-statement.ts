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

      // Count non-pass statements in the block
      const nonPass = parent.namedChildren.filter((c) => c.type !== 'pass_statement')
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
        if (c === node) return false
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
