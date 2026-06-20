import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** Nearest enclosing method/local-function declaration, or null. */
function enclosingMethodName(node: SyntaxNode): string | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'method_declaration' || current.type === 'local_function_statement') {
      return current.childForFieldName('name')?.text ?? null
    }
    // A finalizer (destructor) is also an allowed-ish context but is itself a
    // misuse target — stop and report by returning a sentinel name.
    if (current.type === 'destructor_declaration') return '~'
    current = current.parent
  }
  return null
}

/**
 * `GC.SuppressFinalize(...)` called outside a `Dispose` method. The call belongs
 * inside `Dispose(bool)` / `Dispose()` to cancel finalization after the object
 * has been cleaned up deterministically. Anywhere else (a finalizer, a regular
 * method, a constructor) it either does nothing useful or wrongly cancels
 * finalization for an object that still needs it.
 *
 * Recognising the call as `GC.SuppressFinalize` is purely syntactic; the
 * enclosing-method-name check (`Dispose`) avoids type resolution.
 */
export const csharpSuppressFinalizeMisuseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/suppressfinalize-misuse',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    if (fn.childForFieldName('name')?.text !== 'SuppressFinalize') return null
    if (fn.childForFieldName('expression')?.text !== 'GC') return null

    const methodName = enclosingMethodName(node)
    // Inside a method literally named Dispose, this is the canonical, correct use.
    if (methodName === 'Dispose') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'GC.SuppressFinalize called outside Dispose',
      'GC.SuppressFinalize belongs inside a Dispose method; called elsewhere it either does nothing or wrongly cancels finalization for an object that still needs it.',
      sourceCode,
      'Move the GC.SuppressFinalize call into the type\'s Dispose method.',
    )
  },
}
