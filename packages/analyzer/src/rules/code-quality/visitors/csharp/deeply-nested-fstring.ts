import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Interpolated string nested 2+ levels inside other interpolated strings
 * (3 `$"…"` levels total). The single-nesting case is owned by
 * nested-template-literal; this rule fires on the genuinely unreadable
 * hole-within-a-hole-within-a-string shape.
 */
export const csharpDeeplyNestedFstringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deeply-nested-fstring',
  languages: ['csharp'],
  nodeTypes: ['interpolated_string_expression'],
  visit(node, filePath, sourceCode) {
    let depth = 0
    let current = node.parent
    while (current) {
      if (current.type === 'interpolated_string_expression') depth++
      current = current.parent
    }
    if (depth < 2) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Deeply nested interpolated string',
      `Interpolated string nested ${depth + 1} levels deep — extract the inner expressions to variables for readability.`,
      sourceCode,
      'Extract the inner interpolated strings to named local variables.',
    )
  },
}
