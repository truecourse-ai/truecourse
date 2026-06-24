import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A stray `;` forming an empty statement inside a block. It is dead syntax —
 * usually a leftover after deleting code or, worse, an accidental loop/if body
 * (`while (cond);`). The `for (;;)` header clauses are not empty statements in
 * the grammar, so they are never flagged; only standalone `;` statements in a
 * block are.
 */
export const csharpEmptyStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-statement',
  languages: ['csharp'],
  nodeTypes: ['empty_statement'],
  visit(node, filePath, sourceCode) {
    if (node.parent?.type !== 'block') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Empty statement',
      'This stray semicolon is an empty statement — either leftover code or an accidental empty loop/branch body.',
      sourceCode,
      'Delete the semicolon.',
    )
  },
}
