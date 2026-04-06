import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDeclarationsInGlobalScopeVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/declarations-in-global-scope',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    if (node.parent?.type !== 'module') return null

    const left = node.childForFieldName('left')
    if (!left) return null

    const name = left.text

    // Skip UPPER_CASE constants (intentional module-level constants)
    if (/^[A-Z_][A-Z_0-9]*$/.test(name)) return null

    // Skip __dunder__ variables
    if (name.startsWith('__') && name.endsWith('__')) return null

    // Skip common patterns: logger, app, etc.
    if (['logger', 'log', 'app', 'api', 'router', 'blueprint'].includes(name)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Mutable variable in global scope',
      `Module-level mutable variable '${name}' creates shared state that is hard to test.`,
      sourceCode,
      'Move into a function, class, or use UPPER_CASE for intended constants.',
    )
  },
}
