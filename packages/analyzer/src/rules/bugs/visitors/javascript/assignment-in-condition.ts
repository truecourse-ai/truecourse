import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const assignmentInConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assignment-in-condition',
  languages: JS_LANGUAGES,
  nodeTypes: ['if_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // The condition is wrapped in a parenthesized_expression
    const inner = condition.type === 'parenthesized_expression'
      ? condition.namedChildren[0]
      : condition

    if (!inner || inner.type !== 'assignment_expression') return null

    return makeViolation(
      this.ruleKey, inner, filePath, 'high',
      'Assignment in condition',
      'This is an assignment (=), not a comparison (=== or ==). This is likely a bug.',
      sourceCode,
      'Use === or == for comparison instead of = for assignment.',
    )
  },
}
