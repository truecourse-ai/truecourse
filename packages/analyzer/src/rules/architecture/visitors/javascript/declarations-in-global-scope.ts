import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const declarationsInGlobalScopeVisitor: CodeRuleVisitor = {
  ruleKey: 'architecture/deterministic/declarations-in-global-scope',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['lexical_declaration'],
  visit(node, filePath, sourceCode) {
    // Only flag if directly under program (global scope)
    if (node.parent?.type !== 'program') return null

    // Skip: const exports, imports, type declarations
    const text = node.text
    if (text.includes('export')) return null

    // Skip simple constants (UPPER_CASE) — those are intentional
    const declarator = node.namedChildren.find((c) => c.type === 'variable_declarator')
    if (declarator) {
      const name = declarator.childForFieldName('name')
      if (name && /^[A-Z_][A-Z_0-9]*$/.test(name.text)) return null
    }

    // Skip if the value is a require() call or import
    if (text.includes('require(')) return null

    // Skip if it's a function/class expression assigned to a variable (common pattern)
    if (declarator) {
      const value = declarator.childForFieldName('value')
      if (value && (value.type === 'arrow_function' || value.type === 'function' || value.type === 'class')) return null
    }

    // Flag mutable global state
    const keyword = node.children[0]
    if (keyword?.text === 'let') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Mutable variable in global scope',
        'Mutable global variable (let) creates shared state that is hard to test and reason about.',
        sourceCode,
        'Move this variable into a function, class, or module scope.',
      )
    }

    return null
  },
}
