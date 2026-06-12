import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_TERMINAL_STATEMENTS } from './_helpers.js'

/**
 * Statements after an unconditional return/throw/break/continue/goto in the
 * same block can never execute. Local functions declared after a return are
 * idiomatic C# (declaration, not execution) and labels remain reachable via
 * goto — both are skipped. `yield break;` also terminates the block.
 */
export const csharpUnreachableCodeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unreachable-code',
  languages: ['csharp'],
  nodeTypes: ['block'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren.filter((c) => c && c.type !== 'comment')
    for (let i = 0; i < children.length - 1; i++) {
      const stmt = children[i]!
      const isTerminal =
        CSHARP_TERMINAL_STATEMENTS.has(stmt.type) ||
        (stmt.type === 'yield_statement' && stmt.children.some((c) => c?.type === 'break'))
      if (!isTerminal) continue

      const unreachable = children[i + 1]!
      if (unreachable.type === 'local_function_statement') continue
      if (unreachable.type === 'labeled_statement') continue

      return makeViolation(
        this.ruleKey, unreachable, filePath, 'medium',
        'Unreachable code',
        `Code after \`${stmt.type.replace('_statement', '')}\` can never execute.`,
        sourceCode,
        'Remove the unreachable code or move it before the terminating statement.',
      )
    }
    return null
  },
}
