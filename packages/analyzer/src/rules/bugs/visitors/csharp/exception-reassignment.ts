import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/**
 * Assigning a new value to the catch parameter (`ex = new AppException(…)`)
 * discards the original exception object — its stack trace, inner exception
 * and data are lost.
 */
export const csharpExceptionReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/exception-reassignment',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const decl = node.namedChildren.find((c) => c?.type === 'catch_declaration')
    const paramName = decl?.childForFieldName('name')?.text
    if (!paramName) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && left.text === paramName) return n
      }
      if (CSHARP_FUNCTION_BOUNDARIES.has(n.type)) return null
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) {
          const found = findReassignment(child)
          if (found) return found
        }
      }
      return null
    }

    const reassignment = findReassignment(body)
    if (!reassignment) return null

    return makeViolation(
      this.ruleKey, reassignment, filePath, 'high',
      'Exception parameter reassignment',
      `Reassigning catch parameter \`${paramName}\` loses the original exception (stack trace, inner exception, data).`,
      sourceCode,
      'Use a different variable for the new value, and pass the original exception as the inner exception when wrapping.',
    )
  },
}
