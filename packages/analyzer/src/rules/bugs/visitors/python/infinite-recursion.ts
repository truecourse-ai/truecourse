import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonInfiniteRecursionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/infinite-recursion',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const name = node.childForFieldName('name')
    if (!name) return null
    const funcName = name.text

    const body = node.childForFieldName('body')
    if (!body) return null

    const statements = body.namedChildren.filter((c) => c.type !== 'comment')
    if (statements.length === 0) return null

    // Check if the first statement (without any condition) is a recursive call
    // We look for expression_statement containing a call to the same function
    function isRecursiveCall(n: import('web-tree-sitter').Node): boolean {
      if (n.type === 'call') {
        const fn = n.childForFieldName('function')
        if (fn?.type === 'identifier' && fn.text === funcName) return true
        // Also handle self.method() — not applicable for module-level functions but skip
      }
      return false
    }

    const first = statements[0]
    // Flag if the very first statement is an unconditional recursive call
    if (first.type === 'expression_statement') {
      const expr = first.namedChildren[0]
      if (expr && isRecursiveCall(expr)) {
        return makeViolation(
          this.ruleKey, first, filePath, 'critical',
          'Infinite recursion',
          `\`${funcName}\` calls itself unconditionally as its first statement — this always raises RecursionError.`,
          sourceCode,
          'Add a base case that terminates the recursion before the recursive call.',
        )
      }
    }

    // Flag if it's the only statement (or the only return path is recursive)
    if (statements.length === 1 && first.type === 'return_statement') {
      const val = first.namedChildren[0]
      if (val && isRecursiveCall(val)) {
        return makeViolation(
          this.ruleKey, first, filePath, 'critical',
          'Infinite recursion',
          `\`${funcName}\` always returns a call to itself — this always raises RecursionError.`,
          sourceCode,
          'Add a base case that terminates the recursion.',
        )
      }
    }

    return null
  },
}
