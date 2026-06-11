import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `finally { }` with an empty body serves no purpose. A finally block
 * containing only comments is left alone — the intent is documented.
 */
export const csharpUselessFinallyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/useless-finally',
  languages: ['csharp'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    const finallyClause = node.namedChildren.find((c) => c?.type === 'finally_clause')
    if (!finallyClause) return null

    const block = finallyClause.namedChildren.find((c) => c?.type === 'block')
    if (!block || block.namedChildren.length !== 0) return null

    return makeViolation(
      this.ruleKey, finallyClause, filePath, 'low',
      'Useless finally block',
      'The `finally` block is empty and serves no purpose — remove it.',
      sourceCode,
      'Remove the empty `finally { }` block.',
    )
  },
}
