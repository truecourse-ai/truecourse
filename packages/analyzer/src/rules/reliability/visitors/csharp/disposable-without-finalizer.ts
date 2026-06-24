import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { simpleTypeName } from './_helpers.js'
import { declaresIDisposable } from './_helpers.js'

/**
 * An IDisposable type that holds an unmanaged resource (an `IntPtr` /
 * `UIntPtr` / `HandleRef` field) but declares no finalizer. If a caller forgets
 * to call Dispose(), the unmanaged handle leaks permanently — a finalizer is
 * the safety net that releases it during GC.
 *
 * Precision: the raw-handle field type (IntPtr/UIntPtr/HandleRef) is matched
 * exactly, so managed disposables (which correctly have NO finalizer, per
 * CA1063) are never flagged. SafeHandle subclasses already finalize and use
 * SafeHandle fields, not raw IntPtr, so they are out of scope by construction.
 */
const UNMANAGED_HANDLE_TYPES = new Set(['IntPtr', 'UIntPtr', 'HandleRef'])

function hasUnmanagedHandleField(body: SyntaxNode): boolean {
  for (const member of body.namedChildren) {
    if (member?.type !== 'field_declaration') continue
    if (member.children.some((c) => c?.type === 'modifier' && c.text === 'static')) continue
    const decl = member.namedChildren.find((c) => c?.type === 'variable_declaration')
    const typeNode = decl?.namedChildren[0]
    if (typeNode && UNMANAGED_HANDLE_TYPES.has(simpleTypeName(typeNode.text))) return true
  }
  return false
}

function hasFinalizer(body: SyntaxNode): boolean {
  return body.namedChildren.some((c) => c?.type === 'destructor_declaration')
}

export const csharpDisposableWithoutFinalizerVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/disposable-without-finalizer',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!declaresIDisposable(node)) return null
    // A sealed type can still leak; finalizer is still the safety net.
    const body = node.namedChildren.find((c) => c?.type === 'declaration_list')
    if (!body) return null

    if (!hasUnmanagedHandleField(body)) return null
    if (hasFinalizer(body)) return null

    const nameNode = node.childForFieldName('name') ?? node
    return makeViolation(
      this.ruleKey, nameNode, filePath, 'medium',
      'Disposable type with unmanaged resource has no finalizer',
      'This IDisposable type holds an unmanaged handle (IntPtr) but declares no finalizer. If a caller forgets to call Dispose(), the handle leaks permanently — a finalizer is the GC-time safety net that releases it.',
      sourceCode,
      'Add a finalizer that releases the unmanaged handle, call GC.SuppressFinalize(this) in Dispose(), and follow the standard Dispose(bool disposing) pattern — or wrap the handle in a SafeHandle, which finalizes for you.',
    )
  },
}
