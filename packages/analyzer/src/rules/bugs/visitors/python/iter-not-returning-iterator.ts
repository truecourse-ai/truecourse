import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonIterNotReturningIteratorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/iter-not-returning-iterator',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== '__iter__') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if there's a yield statement (makes it a generator — fine)
    function hasYield(n: import('web-tree-sitter').Node): boolean {
      if (n.type === 'yield' || n.type === 'yield_statement') return true
      if (n.type === 'function_definition') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasYield(child)) return true
      }
      return false
    }
    if (hasYield(body)) return null

    // Check if there's a return self statement
    function hasReturnSelf(n: import('web-tree-sitter').Node): boolean {
      if (n.type === 'return_statement') {
        const val = n.namedChildren[0]
        if (val?.type === 'identifier' && val.text === 'self') return true
      }
      if (n.type === 'function_definition') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasReturnSelf(child)) return true
      }
      return false
    }

    function hasAnyReturn(n: import('web-tree-sitter').Node): boolean {
      if (n.type === 'return_statement' && n.namedChildren.length > 0) return true
      if (n.type === 'function_definition') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasAnyReturn(child)) return true
      }
      return false
    }

    if (hasAnyReturn(body) && !hasReturnSelf(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        '__iter__ not returning iterator',
        '`__iter__` should return `self` (if the object is its own iterator) or a dedicated iterator — returning other values breaks the iterator protocol.',
        sourceCode,
        'Return `self` from `__iter__`, or implement `__next__` and return `self`, or use `yield` to make it a generator.',
      )
    }

    return null
  },
}
