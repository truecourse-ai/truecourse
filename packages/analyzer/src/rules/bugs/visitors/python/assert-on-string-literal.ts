import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAssertOnStringLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assert-on-string-literal',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.namedChildren[0]
    if (!condition) return null

    if (condition.type === 'string' || condition.type === 'concatenated_string') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Assert on string literal',
        `\`assert ${condition.text}\` is always True because a non-empty string is truthy — the assertion never fails.`,
        sourceCode,
        'Pass the string as the assertion message: `assert condition, "message"`.',
      )
    }
    return null
  },
}
