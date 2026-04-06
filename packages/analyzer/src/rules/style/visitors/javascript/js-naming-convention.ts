import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const jsNamingConventionVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/js-naming-convention',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name) return null

    const funcName = name.text
    // Skip React components (PascalCase is fine for them)
    if (/^[A-Z]/.test(funcName)) {
      // Check if it looks like a React component (returns JSX)
      const body = node.childForFieldName('body')
      if (body && (body.text.includes('jsx') || body.text.includes('<'))) return null

      // Non-component PascalCase function — could be a class-like factory, skip
      return null
    }

    // Functions should be camelCase
    if (funcName.includes('_') && !funcName.startsWith('_')) {
      // snake_case function in JS
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Function uses snake_case naming',
        `Function '${funcName}' uses snake_case. JavaScript convention is camelCase.`,
        sourceCode,
        `Rename to camelCase: ${funcName.replace(/_([a-z])/g, (_, c) => c.toUpperCase())}.`,
      )
    }

    return null
  },
}
