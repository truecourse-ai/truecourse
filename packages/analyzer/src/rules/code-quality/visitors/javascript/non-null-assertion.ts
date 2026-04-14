import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const nonNullAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/non-null-assertion',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['non_null_expression'],
  visit(node, filePath, sourceCode) {
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Non-null assertion',
      '`!` postfix asserts a value is non-null, bypassing TypeScript null checks. This can cause runtime errors.',
      sourceCode,
      'Add a proper null check or use optional chaining (`?.`) instead.',
    )
  },
}
