import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `for (; condition;)` with no initializer or update — `while (condition)`
 * says the same thing without the empty clauses.
 */
export const csharpPreferWhileVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-while',
  languages: ['csharp'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('initializer')) return null
    if (node.childForFieldName('update')) return null
    if (!node.childForFieldName('condition')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer while loop',
      '`for (; condition;)` with no initializer or update is clearer as `while (condition)`.',
      sourceCode,
      'Replace `for (; condition;) { … }` with `while (condition) { … }`.',
    )
  },
}
