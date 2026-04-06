import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNamingConventionVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/python-naming-convention',
  languages: ['python'],
  nodeTypes: ['function_definition', 'class_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name) return null

    const identifier = name.text

    if (node.type === 'class_definition') {
      // Classes should be PascalCase
      if (identifier.includes('_') && !identifier.startsWith('_')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Class not in PascalCase',
          `Class '${identifier}' uses snake_case. Python convention is PascalCase for classes.`,
          sourceCode,
          `Rename to PascalCase: ${identifier.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('')}.`,
        )
      }
    }

    if (node.type === 'function_definition') {
      // Functions should be snake_case — skip dunder methods and private
      if (identifier.startsWith('__') && identifier.endsWith('__')) return null

      // PascalCase function in Python is suspicious
      if (/^[A-Z][a-z]/.test(identifier) && !identifier.includes('_')) {
        // Could be a class factory, but flag it
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Function in PascalCase',
          `Function '${identifier}' uses PascalCase. Python convention is snake_case for functions.`,
          sourceCode,
          'Rename to snake_case unless this is intentionally a class-like factory.',
        )
      }

      // camelCase function in Python
      if (/^[a-z]+[A-Z]/.test(identifier) && !identifier.includes('_')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Function in camelCase',
          `Function '${identifier}' uses camelCase. Python convention is snake_case for functions.`,
          sourceCode,
          `Rename to snake_case: ${identifier.replace(/[A-Z]/g, c => '_' + c.toLowerCase())}.`,
        )
      }
    }

    return null
  },
}
