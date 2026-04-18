import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects generator functions using return with a value.
 * In Python 3.3+, return in a generator raises StopIteration with the value,
 * but this is confusing and should be replaced with yield.
 */
export const pythonReturnInGeneratorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/return-in-generator',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if this is a generator (has yield statement)
    let hasYield = false

    function findYield(n: import('tree-sitter').SyntaxNode): void {
      if (n.type === 'yield' || n.type === 'yield_from_statement') {
        hasYield = true
        return
      }
      // Don't descend into nested function definitions
      if (n.id !== body?.id && (n.type === 'function_definition' || n.type === 'class_definition')) return
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && !hasYield) findYield(child)
      }
    }

    findYield(body)

    if (!hasYield) return null

    // Look for return statements with values
    function findReturnWithValue(n: import('tree-sitter').SyntaxNode): import('tree-sitter').SyntaxNode | null {
      if (n.type === 'return_statement') {
        // Return with a value has named children
        const returnValue = n.namedChildren[0]
        if (returnValue) return n
      }
      // Don't descend into nested function definitions
      if (n.id !== body?.id && (n.type === 'function_definition' || n.type === 'class_definition')) return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const result = findReturnWithValue(child)
          if (result) return result
        }
      }
      return null
    }

    const returnWithValue = findReturnWithValue(body)
    if (!returnWithValue) return null

    const funcName = node.childForFieldName('name')?.text ?? 'generator'

    return makeViolation(
      this.ruleKey, returnWithValue, filePath, 'medium',
      'Return value in generator function',
      `Generator function \`${funcName}\` uses \`return\` with a value — this raises \`StopIteration\` with the value, which is confusing. Use \`yield\` instead.`,
      sourceCode,
      `Replace \`return value\` with \`yield value\` in generator functions.`,
    )
  },
}
