import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CANCELLATION_EXCEPTIONS } from './_helpers.js'

export const pythonCancellationExceptionNotReraisedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/cancellation-exception-not-reraised',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const children = node.children

    // Check if this except clause catches CancelledError
    let catchesCancelledError = false
    for (const child of children) {
      if (child.type === 'identifier' && CANCELLATION_EXCEPTIONS.has(child.text)) {
        catchesCancelledError = true
        break
      }
      if (child.type === 'attribute') {
        const attr = child.childForFieldName('attribute')
        if (attr && CANCELLATION_EXCEPTIONS.has(attr.text)) {
          catchesCancelledError = true
          break
        }
      }
    }
    if (!catchesCancelledError) return null

    const body = node.namedChildren.find((c) => c.type === 'block')
    if (!body) return null

    // Check if the body re-raises (bare raise or raise <same var>)
    function hasReraise(n: import('tree-sitter').SyntaxNode): boolean {
      if (n.type === 'raise_statement') {
        // Bare raise — re-raises current exception
        if (n.namedChildren.length === 0) return true
        // raise e or raise ... from ...
        return true
      }
      if (n.type === 'function_definition') return false
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child && hasReraise(child)) return true
      }
      return false
    }

    if (!hasReraise(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Cancellation exception swallowed',
        'Catching `CancelledError` without re-raising prevents task cancellation and may deadlock the event loop.',
        sourceCode,
        'Add `raise` at the end of the except block to re-raise the cancellation.',
      )
    }

    return null
  },
}
