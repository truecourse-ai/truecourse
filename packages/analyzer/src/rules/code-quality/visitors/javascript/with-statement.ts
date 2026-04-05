import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const withStatementVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/with-statement',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['with_statement'],
  visit(node, filePath, sourceCode) {
    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'with statement',
      '`with` statement is confusing, deprecated in strict mode, and disallowed in TypeScript. Remove it.',
      sourceCode,
      'Replace `with (obj) { ... }` by assigning `obj` to a variable and accessing its properties explicitly.',
    )
  },
}
