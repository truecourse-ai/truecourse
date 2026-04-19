import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const exceptionReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/exception-reassignment',
  languages: JS_LANGUAGES,
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const param = node.childForFieldName('parameter')
    if (!param) return null

    // The parameter might be an identifier or a destructuring pattern
    const paramName = param.type === 'identifier' ? param.text : null
    if (!paramName) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    function findReassignment(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'assignment_expression' || n.type === 'augmented_assignment_expression') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && left.text === paramName) {
          return n
        }
      }
      if (n.type === 'function_declaration' || n.type === 'arrow_function' || n.type === 'function') return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const found = findReassignment(child)
          if (found) return found
        }
      }
      return null
    }

    const reassignment = findReassignment(body)
    if (reassignment) {
      return makeViolation(
        this.ruleKey, reassignment, filePath, 'high',
        'Exception parameter reassignment',
        `Reassigning catch parameter \`${paramName}\` loses the original error information.`,
        sourceCode,
        'Use a different variable name instead of reassigning the catch parameter.',
      )
    }
    return null
  },
}
