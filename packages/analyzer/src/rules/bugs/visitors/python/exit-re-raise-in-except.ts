import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonExitReRaiseInExceptVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/exit-re-raise-in-except',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name || name.text !== '__exit__') return null

    const params = node.childForFieldName('parameters')
    if (!params) return null

    // Get parameter names: (self, exc_type, exc_val, exc_tb)
    const paramNames = params.namedChildren
      .filter((c) => c.type === 'identifier')
      .map((c) => c.text)
    if (paramNames.length < 3) return null

    const excType = paramNames[1] // exc_type
    const excVal = paramNames[2]  // exc_val

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReRaise(n: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
      if (n.type === 'raise_statement') {
        const raised = n.namedChildren[0]
        // raise exc_val or raise exc_type(...)
        if (raised?.type === 'identifier' && (raised.text === excVal || raised.text === excType)) {
          return n
        }
      }
      if (n.type === 'function_definition') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReRaise(child)
          if (found) return found
        }
      }
      return null
    }

    const badRaise = findReRaise(body)
    if (badRaise) {
      return makeViolation(
        this.ruleKey, badRaise, filePath, 'medium',
        '__exit__ should not re-raise exception',
        `\`__exit__\` re-raises the exception parameter directly — this is not the correct way to propagate exceptions. Return \`False\` (or nothing) to let the exception propagate, or return \`True\` to suppress it.`,
        sourceCode,
        'Remove the `raise` statement and return `False` to propagate, or `True` to suppress the exception.',
      )
    }
    return null
  },
}
