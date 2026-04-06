import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const unnecessaryContextProviderVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/unnecessary-context-provider',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_element'],
  visit(node, filePath, sourceCode) {
    const openingTag = node.namedChildren.find((c) => c.type === 'jsx_opening_element')
    if (!openingTag) return null

    const tagName = openingTag.namedChildren.find((c) => c.type === 'member_expression' || c.type === 'identifier')
    if (!tagName) return null

    // Check for .Provider suffix
    if (!tagName.text.endsWith('.Provider')) return null

    // Count JSX children (non-whitespace)
    const children = node.namedChildren.filter((c) =>
      c.type !== 'jsx_opening_element' &&
      c.type !== 'jsx_closing_element' &&
      c.type !== 'jsx_text',
    )

    if (children.length === 1) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Context provider wrapping single child',
        `${tagName.text} wraps only a single child. Consider whether the context is necessary or if props would suffice.`,
        sourceCode,
        'Consider passing props directly instead of using context for a single child.',
      )
    }

    return null
  },
}
