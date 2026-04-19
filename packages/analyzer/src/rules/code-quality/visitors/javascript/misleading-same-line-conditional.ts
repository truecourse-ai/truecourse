import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const misleadingSameLineConditionalVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/misleading-same-line-conditional',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Detect: two if statements on the same line where the second follows the first's single-stmt body
    // i.e., `if (a) doA(); if (b) doB();` — looks like else-if but isn't
    const parent = node.parent
    if (!parent) return null

    // Check if this if_statement starts on the same line as a previous statement's end
    const startLine = node.startPosition.row

    let prevSibling: import('web-tree-sitter').Node | null = null
    for (let i = 0; i < parent.childCount; i++) {
      const child = parent.child(i)
      if (!child) continue
      if (child.id === node.id) break
      if (child.isNamed) prevSibling = child
    }

    if (!prevSibling) return null
    const prevEndLine = prevSibling.endPosition.row

    // If previous statement ends on the same line that this if starts on
    if (prevEndLine === startLine && prevSibling.type === 'if_statement') {
      // The previous if has no else — this if looks like it might be the else
      const prevHasElse = prevSibling.children.some((c) => c.type === 'else_clause')
      if (!prevHasElse) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Misleading same-line conditional',
          'Two `if` statements on the same line — the second may be mistaken for an `else` branch. Put each statement on its own line.',
          sourceCode,
          'Move the second `if` to a new line, or use `else if` if that was the intent.',
        )
      }
    }
    return null
  },
}
