import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonInitReturnValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/init-return-value',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== '__init__') return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReturnWithValue(n: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
      if (n.type === 'return_statement') {
        const val = n.namedChildren[0]
        if (val && val.type !== 'none') return n
      }
      if (n.type === 'function_definition') return null // don't recurse into nested functions
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReturnWithValue(child)
          if (found) return found
        }
      }
      return null
    }

    const badReturn = findReturnWithValue(body)
    if (badReturn) {
      return makeViolation(
        this.ruleKey, badReturn, filePath, 'high',
        '__init__ returns a value',
        '`__init__` must return `None`. Python ignores any return value from `__init__`, so this is almost certainly a bug.',
        sourceCode,
        'Remove the return value from `__init__`, or move the logic to a class method or `__new__`.',
      )
    }

    return null
  },
}
