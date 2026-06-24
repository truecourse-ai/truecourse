import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A manual `if (token.IsCancellationRequested) throw new
 * OperationCanceledException();` restates exactly what
 * `token.ThrowIfCancellationRequested()` does in one call — and the helper
 * also captures the token in the thrown exception for correct cancellation
 * propagation (CA2250). The check fires on an `if` with no `else` whose
 * condition is a bare `<expr>.IsCancellationRequested` member access and whose
 * body is a single `throw new OperationCanceledException(...)`.
 */

function isCancellationRequestedCheck(condition: SyntaxNode | null): string | null {
  if (condition?.type !== 'member_access_expression') return null
  if (condition.childForFieldName('name')?.text !== 'IsCancellationRequested') return null
  return condition.childForFieldName('expression')?.text ?? null
}

function loneThrow(branch: SyntaxNode | null): SyntaxNode | null {
  if (!branch) return null
  let stmt: SyntaxNode | null = branch
  if (stmt.type === 'block') {
    const inner = stmt.namedChildren.filter((c) => c && c.type !== 'comment')
    if (inner.length !== 1) return null
    stmt = inner[0]!
  }
  return stmt?.type === 'throw_statement' ? stmt : null
}

function throwsOperationCanceled(throwStmt: SyntaxNode): boolean {
  const creation = throwStmt.namedChildren.find((c) => c?.type === 'object_creation_expression')
  if (!creation) return false
  const type = creation.namedChildren.find((c) => c?.type !== 'argument_list' && c?.type !== 'initializer_expression')
  const name = (type?.text ?? '').split('.').pop()
  return name === 'OperationCanceledException' || name === 'TaskCanceledException'
}

export const csharpUseThrowIfCancellationRequestedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-throwifcancellationrequested',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('alternative')) return null

    const token = isCancellationRequestedCheck(node.childForFieldName('condition'))
    if (token == null) return null

    const throwStmt = loneThrow(node.childForFieldName('consequence'))
    if (!throwStmt || !throwsOperationCanceled(throwStmt)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use ThrowIfCancellationRequested',
      `This manual \`IsCancellationRequested\` check followed by \`throw new OperationCanceledException\` restates \`${token}.ThrowIfCancellationRequested()\`, which also captures the token for correct cancellation propagation (CA2250).`,
      sourceCode,
      `Replace the check-and-throw with \`${token}.ThrowIfCancellationRequested();\`.`,
    )
  },
}
