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
      // Ensure there's no conditional path that could skip the exit
      const hasContinue = statements.some((s) => s.type === 'continue_statement')
      if (hasContinue) return null

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
