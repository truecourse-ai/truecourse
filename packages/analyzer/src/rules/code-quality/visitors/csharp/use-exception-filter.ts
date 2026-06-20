import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A catch block whose first action is to re-check the exception and bare-`throw`
 * when it does not match unwinds and re-raises the stack unnecessarily; a `when`
 * filter decides *before* entering the handler, preserving the original throw
 * point (RCS1236). The check fires on a `catch_clause` with no existing
 * `when`/`catch_filter_clause` whose handler's first statement is an
 * `if (<cond>) throw;` (a bare rethrow).
 */
function isBareRethrow(branch: SyntaxNode | null): boolean {
  if (!branch) return false
  let stmt: SyntaxNode | null = branch
  if (branch.type === 'block') {
    const stmts = branch.namedChildren.filter((c) => c && c.type !== 'comment')
    if (stmts.length !== 1) return false
    stmt = stmts[0]!
  }
  // A bare rethrow is `throw;` — a throw_statement with no thrown expression.
  return stmt?.type === 'throw_statement' && stmt.namedChildCount === 0
}

export const csharpUseExceptionFilterVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-exception-filter',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // Already filtered with `when (...)` — nothing to do.
    if (node.namedChildren.some((c) => c?.type === 'catch_filter_clause')) return null

    const block = node.namedChildren.find((c) => c?.type === 'block')
    if (!block) return null
    const first = block.namedChildren.find((c) => c && c.type !== 'comment')
    if (first?.type !== 'if_statement') return null

    // No else branch: the guard's only purpose is the conditional rethrow.
    const cond = first.childForFieldName('condition')
    const branches = first.namedChildren.filter((c) => c && c.id !== cond?.id) as SyntaxNode[]
    if (branches.length !== 1) return null
    if (!isBareRethrow(branches[0])) return null

    return makeViolation(
      this.ruleKey, first, filePath, 'low',
      'Use an exception filter',
      'This catch re-checks the exception and rethrows when it does not match — a `when` filter decides without entering the handler, preserving the original throw point.',
      sourceCode,
      'Move the condition into a `catch (… ex) when (<condition>)` filter.',
    )
  },
}
