import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects assertion statements inside except blocks.
 * An assertion after catching an expected exception should be in the else block.
 */
export const pythonAssertionAfterExpectedExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assertion-after-expected-exception',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    // Look for assert statements in the except body
    for (const stmt of body.namedChildren) {
      if (stmt.type === 'assert_statement') {
        return makeViolation(
          this.ruleKey, stmt, filePath, 'high',
          'Assertion at end of except block',
          'An assertion inside an `except` block runs when an exception was caught — it should be in an `else` block or after the `try/except` to verify the happy path.',
          sourceCode,
          'Move the assertion to the `else` block of the try/except, or after the try/except block, to test the non-exception case.',
        )
      }
    }

    return null
  },
}
