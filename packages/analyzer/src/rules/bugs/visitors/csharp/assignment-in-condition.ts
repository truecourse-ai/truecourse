import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { unwrapParens } from './_helpers.js'

/**
 * `if (enabled = true)` / `while (done = Check())` — an assignment used
 * directly as a condition (only compiles in C# when the assigned value is
 * bool, which is exactly the typo case for `==`).
 *
 * `while ((line = reader.ReadLine()) != null)` does NOT fire — there the
 * condition is the surrounding comparison, not the assignment.
 */
export const csharpAssignmentInConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assignment-in-condition',
  languages: ['csharp'],
  nodeTypes: ['if_statement', 'while_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    const inner = unwrapParens(condition)
    if (inner.type !== 'assignment_expression') return null
    if (inner.childForFieldName('operator')?.text !== '=') return null

    return makeViolation(
      this.ruleKey, inner, filePath, 'high',
      'Assignment in condition',
      'This is an assignment (=), not a comparison (==). The condition always takes the assigned value.',
      sourceCode,
      'Use == for comparison instead of = for assignment.',
    )
  },
}
