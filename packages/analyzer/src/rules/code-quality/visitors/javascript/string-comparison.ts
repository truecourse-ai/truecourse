import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const stringComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/string-comparison',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.children.find((c) => c.type === '<' || c.type === '>' || c.type === '<=' || c.type === '>=')
    if (!op) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    if (left.type === 'string' && right.type === 'string') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'String comparison with relational operator',
        `Comparing string literals with \`${op.text}\` is locale-dependent. Use \`localeCompare()\` for sorting.`,
        sourceCode,
        'Use `a.localeCompare(b)` for locale-aware string comparison.',
      )
    }
    return null
  },
}
