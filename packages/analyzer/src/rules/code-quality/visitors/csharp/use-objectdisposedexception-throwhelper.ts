import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A disposed-state guard `if (_disposed) throw new ObjectDisposedException(...)`
 * restates `ObjectDisposedException.ThrowIf(_disposed, this)` (CA1513). The check
 * fires on an `if_statement` whose single consequence is
 * `throw new ObjectDisposedException(...)` and which has no else branch.
 */
function singleThrowOf(branch: SyntaxNode | null, exceptionType: string): boolean {
  if (!branch) return false
  let stmt: SyntaxNode | null = branch
  if (branch.type === 'block') {
    const stmts = branch.namedChildren.filter((c) => c && c.type !== 'comment')
    if (stmts.length !== 1) return false
    stmt = stmts[0]!
  }
  if (stmt?.type !== 'throw_statement') return false
  const creation = stmt.namedChildren.find((c) => c?.type === 'object_creation_expression')
  if (!creation) return false
  const typeName = creation.namedChildren.find((c) => c?.type === 'identifier' || c?.type === 'qualified_name')?.text
  return typeName?.split('.').pop() === exceptionType
}

export const csharpUseObjectDisposedExceptionThrowHelperVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-objectdisposedexception-throwhelper',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    const branches = node.namedChildren.filter((c) => c && c.id !== condition.id) as SyntaxNode[]
    if (branches.length !== 1) return null

    if (!singleThrowOf(branches[0], 'ObjectDisposedException')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use ObjectDisposedException.ThrowIf',
      'This disposed-state guard restates `ObjectDisposedException.ThrowIf(...)`, the dedicated throw helper.',
      sourceCode,
      'Replace the guard with `ObjectDisposedException.ThrowIf(<disposedFlag>, this);`.',
    )
  },
}
