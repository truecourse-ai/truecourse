import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A catch clause that only rethrows. C#-specific carve-outs:
 *   - `when (…)` filters make the clause meaningful
 *   - a rethrowing catch ALONGSIDE other catch clauses is a deliberate
 *     "let this type bypass the general handler" — only flag when it is the
 *     try's sole catch clause
 */
export function csharpUselessCatch(node: SyntaxNode): { paramName: string; rethrowsByName: boolean } | null {
  if (node.type !== 'catch_clause') return null
  if (node.namedChildren.some((c) => c?.type === 'catch_filter_clause')) return null

  const tryStatement = node.parent
  if (tryStatement?.type !== 'try_statement') return null
  const catchCount = tryStatement.namedChildren.filter((c) => c?.type === 'catch_clause').length
  if (catchCount !== 1) return null

  const body = node.childForFieldName('body') ?? node.namedChildren.find((c) => c?.type === 'block')
  if (!body) return null
  const stmts = body.namedChildren.filter((c) => c && c.type !== 'comment')
  if (stmts.length !== 1 || stmts[0]?.type !== 'throw_statement') return null

  const thrown = stmts[0].namedChildren[0]
  const declaration = node.namedChildren.find((c) => c?.type === 'catch_declaration')
  const paramName = declaration?.childForFieldName('name')?.text ?? ''

  // Bare `throw;` always rethrows the original.
  if (!thrown) return { paramName, rethrowsByName: false }
  // `throw ex;` rethrows the caught exception (and resets its stack trace).
  if (thrown.type === 'identifier' && paramName && thrown.text === paramName) {
    return { paramName, rethrowsByName: true }
  }
  return null
}

export const csharpNoUselessCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-useless-catch',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const useless = csharpUselessCatch(node)
    if (!useless) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Useless catch clause',
      'This catch only re-throws the exception. Remove the try/catch or add error handling/context.',
      sourceCode,
      'Remove the try/catch block, or add error handling, logging, or wrapping before re-throwing.',
    )
  },
}
