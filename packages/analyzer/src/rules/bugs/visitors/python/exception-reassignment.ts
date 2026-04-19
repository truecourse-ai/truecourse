import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonExceptionReassignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/exception-reassignment',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    // Find the exception variable from the as_pattern
    let exceptionVar: string | null = null

    for (const child of node.namedChildren) {
      if (child.type === 'as_pattern') {
        const target = child.namedChildren.find((c) => c.type === 'as_pattern_target')
        if (target) {
          const id = target.namedChildren.find((c) => c.type === 'identifier')
          if (id) exceptionVar = id.text
        }
      }
    }
    if (!exceptionVar) return null

    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    // Find assignment to the exception variable
    function findReassignment(n: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
      if (n.type === 'assignment') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && left.text === exceptionVar) {
          return n
        }
      }
      if (n.type === 'augmented_assignment') {
        const left = n.childForFieldName('left')
        if (left?.type === 'identifier' && left.text === exceptionVar) {
          return n
        }
      }
      if (n.type === 'function_definition') return null
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
        `Reassigning except parameter \`${exceptionVar}\` loses the original error information.`,
        sourceCode,
        'Use a different variable name instead of reassigning the except parameter.',
      )
    }
    return null
  },
}
