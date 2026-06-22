import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A unary `+` applied to an expression is a no-op the reader has to pause over.
 * It produces the operand unchanged and only adds visual noise — it is usually
 * a typo for `++`, `+=`, or a binary `+` with a missing left operand. The `+`
 * token is the first child of the `prefix_unary_expression`.
 */
export const csharpUnnecessaryUnaryPlusVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-unary-plus',
  languages: ['csharp'],
  nodeTypes: ['prefix_unary_expression'],
  visit(node, filePath, sourceCode) {
    if (node.children[0]?.text !== '+') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary unary plus',
      'A unary `+` is a no-op that leaves its operand unchanged and only adds visual noise.',
      sourceCode,
      'Remove the redundant unary `+`.',
    )
  },
}
