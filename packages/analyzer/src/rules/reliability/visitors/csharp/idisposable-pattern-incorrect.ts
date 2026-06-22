import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { declaresIDisposable } from './_helpers.js'

/**
 * A type that implements IDisposable AND declares a finalizer but provides no
 * `protected virtual void Dispose(bool disposing)` to unify them. The standard
 * dispose pattern routes both `Dispose()` and the finalizer through one
 * `Dispose(bool)` so each cleans up the right set of resources exactly once and
 * `GC.SuppressFinalize` can suppress the redundant finalize. Without it, the
 * finalizer and `Dispose()` run independent cleanup — risking double-release or
 * use of already-collected managed objects from the finalizer thread.
 *
 * Precision: we require BOTH a finalizer and a public Dispose() to be present
 * (the unambiguous "two cleanup paths, no coordination" shape). A managed-only
 * disposable with no finalizer is correct and never flagged; the missing-
 * finalizer-for-unmanaged case is owned by disposable-without-finalizer.
 */
function findMember(
  body: SyntaxNode,
  pred: (m: SyntaxNode) => boolean,
): SyntaxNode | null {
  for (const member of body.namedChildren) {
    if (member && pred(member)) return member
  }
  return null
}

function isParameterlessDispose(member: SyntaxNode): boolean {
  if (member.type !== 'method_declaration') return false
  if (member.childForFieldName('name')?.text !== 'Dispose') return false
  const params = member.childForFieldName('parameters')
  return !params || params.namedChildCount === 0
}

function isDisposeBoolOverload(member: SyntaxNode): boolean {
  if (member.type !== 'method_declaration') return false
  if (member.childForFieldName('name')?.text !== 'Dispose') return false
  const params = member.childForFieldName('parameters')
  if (!params || params.namedChildCount !== 1) return false
  const param = params.namedChildren[0]
  return param?.namedChildren.some((c) => c?.type === 'predefined_type' && c.text === 'bool') ?? false
}

export const csharpIDisposablePatternIncorrectVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/idisposable-pattern-incorrect',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (!declaresIDisposable(node)) return null

    const body = node.namedChildren.find((c) => c?.type === 'declaration_list')
    if (!body) return null

    const finalizer = findMember(body, (m) => m.type === 'destructor_declaration')
    if (!finalizer) return null

    const publicDispose = findMember(body, isParameterlessDispose)
    if (!publicDispose) return null

    // The unifying Dispose(bool) overload is what makes the pattern correct.
    if (findMember(body, isDisposeBoolOverload)) return null

    const nameNode = node.childForFieldName('name') ?? node
    return makeViolation(
      this.ruleKey, nameNode, filePath, 'medium',
      'IDisposable pattern implemented incorrectly',
      'This type has both a finalizer and a public Dispose() but no protected virtual void Dispose(bool disposing) to unify them. The two cleanup paths run independently, risking double-release or touching already-finalized managed objects.',
      sourceCode,
      'Implement the standard dispose pattern: route Dispose() and the finalizer through a single protected virtual void Dispose(bool disposing), and call GC.SuppressFinalize(this) from Dispose().',
    )
  },
}
