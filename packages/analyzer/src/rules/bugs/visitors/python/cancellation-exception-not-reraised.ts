import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CANCELLATION_EXCEPTIONS } from './_helpers.js'

function findEnclosingFunction(node: import('web-tree-sitter').Node): import('web-tree-sitter').Node | null {
  let current: import('web-tree-sitter').Node | null = node.parent
  while (current) {
    if (current.type === 'function_definition') return current
    current = current.parent
  }
  return null
}

/**
 * Check if a function body contains a `.cancel()` method call.
 * This indicates the function intentionally cancels a task, so catching
 * CancelledError is expected behavior (caller-initiated cancellation).
 */
function hasCancelCall(funcNode: import('web-tree-sitter').Node): boolean {
  function walk(n: import('web-tree-sitter').Node): boolean {
    if (n.type === 'call') {
      const func = n.childForFieldName('function')
      if (func?.type === 'attribute') {
        const attr = func.childForFieldName('attribute')
        if (attr?.text === 'cancel') return true
      }
    }
    // Don't recurse into nested function definitions
    if (n.type === 'function_definition' && n !== funcNode) return false
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child && walk(child)) return true
    }
    return false
  }
  return walk(funcNode)
}

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
    function hasReraise(n: import('web-tree-sitter').Node): boolean {
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
      // Check if the enclosing function intentionally cancels a task
      // (calls `.cancel()` on a task variable). In that case, catching
      // CancelledError without re-raising is correct — the caller initiated
      // the cancellation itself (e.g., `task.cancel(); await task`).
      const enclosingFunc = findEnclosingFunction(node)
      if (enclosingFunc && hasCancelCall(enclosingFunc)) return null

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
