import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonBreakContinueInFinallyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/break-continue-in-finally',
  languages: ['python'],
  nodeTypes: ['finally_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    function findBreakOrContinue(n: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
      if (n.type === 'break_statement' || n.type === 'continue_statement') return n
      // Don't recurse into nested loops — break/continue there is fine
      if (n.type === 'for_statement' || n.type === 'while_statement') return null
      // Don't recurse into nested functions
      if (n.type === 'function_definition') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findBreakOrContinue(child)
          if (found) return found
        }
      }
      return null
    }

    const bad = findBreakOrContinue(body)
    if (bad) {
      return makeViolation(
        this.ruleKey, bad, filePath, 'high',
        'break/continue in finally block',
        `\`${bad.type.replace('_statement', '')}\` inside a \`finally\` block silently discards any active exception.`,
        sourceCode,
        'Remove the break/continue from the finally block.',
      )
    }

    return null
  },
}
