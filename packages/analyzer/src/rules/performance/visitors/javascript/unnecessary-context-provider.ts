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
      // Skip when the single child is a PascalCase component — wrapping one root component
      // in a Provider is the standard React pattern (app root, layout wrappers)
      const child = children[0]
      if (child.type === 'jsx_element') {
        const childTag = child.namedChildren.find((c) => c.type === 'jsx_opening_element')
        const childName = childTag?.namedChildren.find((c) => c.type === 'identifier' || c.type === 'member_expression')
        if (childName && /^[A-Z]/.test(childName.text)) return null
      }
      if (child.type === 'jsx_self_closing_element') {
        const childName = child.namedChildren.find((c) => c.type === 'identifier' || c.type === 'member_expression')
        if (childName && /^[A-Z]/.test(childName.text)) return null
      }
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
