import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/**
 * `throw` inside a finally block — if the finally runs because an exception
 * is propagating, the new throw replaces and silently discards the original
 * exception. (C# already forbids return/break/continue in finally, so throw
 * is the only escape this rule needs to cover.)
 *
 * Throws inside a nested try-with-catch are handled there and don't fire.
 */
function findThrow(n: SyntaxNode): SyntaxNode | null {
  if (n.type === 'throw_statement' || n.type === 'throw_expression') return n
  if (CSHARP_FUNCTION_BOUNDARIES.has(n.type)) return null
  if (n.type === 'try_statement' && n.namedChildren.some((c) => c?.type === 'catch_clause')) {
    // Only the finally of the nested try can leak a throw outward
    const nestedFinally = n.namedChildren.find((c) => c?.type === 'finally_clause')
    return nestedFinally ? findThrow(nestedFinally) : null
  }
  for (let i = 0; i < n.namedChildCount; i++) {
    const child = n.namedChild(i)
    if (child) {
      const found = findThrow(child)
      if (found) return found
    }
  }
  return null
}

export const csharpUnsafeFinallyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unsafe-finally',
  languages: ['csharp'],
  nodeTypes: ['finally_clause'],
  visit(node, filePath, sourceCode) {
    const block = node.namedChildren.find((c) => c?.type === 'block')
    if (!block) return null

    const thrown = findThrow(block)
    if (!thrown) return null

    return makeViolation(
      this.ruleKey, thrown, filePath, 'high',
      'Throw in finally block',
      'Throwing from a finally block replaces any exception that is currently propagating — the original error is silently discarded.',
      sourceCode,
      'Move the throw out of the finally, or guard the cleanup so it cannot throw (e.g. wrap it in its own try/catch).',
    )
  },
}
