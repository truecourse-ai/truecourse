import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonYieldInInitVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/yield-in-init',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== '__init__') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findYield(n: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
      if (n.type === 'yield' || n.type === 'yield_statement') return n
      if (n.type === 'function_definition') return null // don't recurse
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findYield(child)
          if (found) return found
        }
      }
      return null
    }

    const yieldNode = findYield(body)
    if (yieldNode) {
      return makeViolation(
        this.ruleKey, yieldNode, filePath, 'high',
        'yield in __init__',
        '`yield` in `__init__` makes it a generator function — calling `MyClass()` returns a generator object instead of an instance.',
        sourceCode,
        'Remove `yield` from `__init__`. Use a separate generator method if needed.',
      )
    }

    return null
  },
}
