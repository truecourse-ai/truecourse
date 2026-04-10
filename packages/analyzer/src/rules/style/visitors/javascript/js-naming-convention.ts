import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { containsJsx } from '../../../_shared/javascript-helpers.js'

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
      // Real AST JSX check — see _shared/javascript-helpers.ts.
      // Used to text-grep for `jsx` or `<` which matched generics and comparisons.
      const body = node.childForFieldName('body')
      if (body && containsJsx(body)) return null

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
