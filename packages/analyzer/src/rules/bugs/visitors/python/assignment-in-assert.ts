import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAssignmentInAssertVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assignment-in-assert',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    function hasWalrus(n: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
      if (n.type === 'named_expression') return n
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = hasWalrus(child)
          if (found) return found
        }
      }
      return null
    }

    const walrus = hasWalrus(node)
    if (walrus) {
      return makeViolation(
        this.ruleKey, walrus, filePath, 'medium',
        'Assignment expression in assert statement',
        `\`assert\` contains a walrus operator (\`:=\`) — assertions are removed when Python is run with \`-O\`, causing the assignment to disappear entirely.`,
        sourceCode,
        'Separate the assignment from the assertion: assign outside the `assert`, then assert the variable.',
      )
    }
    return null
  },
}
