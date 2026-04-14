import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { SPECIAL_METHOD_RETURN_CONSTRAINTS } from './_helpers.js'

export const pythonInvalidSpecialMethodReturnTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-special-method-return-type',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name) return null
    const constraint = SPECIAL_METHOD_RETURN_CONSTRAINTS[name.text]
    if (!constraint) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const methodName = name.text
    // Find any return statements with a literal of the wrong type
    function findBadReturn(n: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
      if (n.type === 'return_statement') {
        const val = n.namedChildren[0]
        if (val && constraint.forbiddenTypes.includes(val.type)) {
          // Special case: __bool__ allows True/False (those are 'true'/'false' node types)
          if (methodName === '__bool__' && (val.text === 'True' || val.text === 'False')) return null
          return n
        }
      }
      if (n.type === 'function_definition') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findBadReturn(child)
          if (found) return found
        }
      }
      return null
    }

    const badReturn = findBadReturn(body)
    if (badReturn) {
      return makeViolation(
        this.ruleKey, badReturn, filePath, 'high',
        'Invalid special method return type',
        `\`${methodName}\` must return ${constraint.expected} — returning a different type will cause a TypeError at runtime.`,
        sourceCode,
        `Change the return value to match the required type: ${constraint.expected}.`,
      )
    }
    return null
  },
}
