import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isLikelyServerComponent } from './_helpers.js'

export const inlineObjectInJsxPropVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/inline-object-in-jsx-prop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_attribute'],
  visit(node, filePath, sourceCode) {
    // Server components don't re-render on the client — inline allocation has no perf impact.
    // Detect by: file is in a Next.js App Router path AND lacks 'use client' directive.
    if (isLikelyServerComponent(filePath, sourceCode)) return null

    const value = node.namedChildren[1]
    if (!value) return null

    const expr = value.type === 'jsx_expression' ? value.namedChildren[0] : value
    if (!expr) return null

    if (expr.type === 'object' || expr.type === 'array') {
      const kind = expr.type === 'object' ? 'Object' : 'Array'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `Inline ${kind.toLowerCase()} literal in JSX prop`,
        `${kind} literal in JSX prop creates a new reference every render, causing unnecessary child re-renders.`,
        sourceCode,
        `Extract the ${kind.toLowerCase()} to a useMemo hook or a constant outside the component.`,
      )
    }

    return null
  },
}
