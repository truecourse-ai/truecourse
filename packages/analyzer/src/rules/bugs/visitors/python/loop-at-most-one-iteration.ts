import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonLoopAtMostOneIterationVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/loop-at-most-one-iteration',
  languages: ['python'],
  nodeTypes: ['for_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0) return null

    const last = statements[statements.length - 1]
    const EXITS = new Set(['return_statement', 'raise_statement', 'break_statement'])

    if (EXITS.has(last.type)) {
      // If the loop body contains a `continue` anywhere (including inside
      // if/else blocks), the loop CAN iterate more than once.
      function containsContinue(n: import('tree-sitter').SyntaxNode): boolean {
        if (n.type === 'continue_statement') return true
        // Don't recurse into nested loops — their `continue` doesn't apply to us
        if (n.type === 'for_statement' || n.type === 'while_statement') return false
        // Don't recurse into nested function definitions
        if (n.type === 'function_definition') return false
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child && containsContinue(child)) return true
        }
        return false
      }
      if (containsContinue(body)) return null

      // Check the last statement is not inside an if
      if (last.parent?.type !== 'block') return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Loop with at most one iteration',
        `Loop body always exits on the first iteration via \`${last.type.replace('_statement', '')}\` — the loop is redundant.`,
        sourceCode,
        'Replace the loop with a plain if statement, or move the exit out of the unconditional position.',
      )
    }

    return null
  },
}
