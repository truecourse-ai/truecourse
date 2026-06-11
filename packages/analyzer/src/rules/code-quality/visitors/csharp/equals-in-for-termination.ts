import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Assignment (`=`) used as a for-loop termination condition. In C# this only
 * compiles for bool conditions (`for (…; done = Check(); …)`), which is
 * almost always a typo for `==` and loops on the assigned value.
 */
export const csharpEqualsInForTerminationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/equals-in-for-termination',
  languages: ['csharp'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition || condition.type !== 'assignment_expression') return null
    if (condition.childForFieldName('operator')?.text !== '=') return null

    return makeViolation(
      this.ruleKey, condition, filePath, 'high',
      'Assignment in for-loop condition',
      'The for-loop condition uses `=` (assignment) instead of `==` (comparison) — the loop tests the assigned value, not a comparison.',
      sourceCode,
      'Replace `=` with `==` in the loop condition, or move the assignment out of the condition.',
    )
  },
}
