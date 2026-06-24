import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

/**
 * `if (d.ContainsKey(k)) d.Remove(k);` does two lookups: `Remove` already
 * returns `false` (and does nothing) when the key is absent, so the guard is a
 * wasted lookup. Fires only when the guarded body is exactly the matching
 * `Remove` on the same receiver and key, with no else branch — so a guard that
 * does extra work is left alone.
 */
function singleStatement(consequence: SyntaxNode): SyntaxNode | null {
  if (consequence.type === 'expression_statement') return consequence
  if (consequence.type === 'block') {
    const stmts = consequence.namedChildren.filter((c): c is SyntaxNode => !!c && c.type !== 'comment')
    return stmts.length === 1 ? stmts[0]! : null
  }
  return null
}

function callInfo(stmt: SyntaxNode): { receiver: string; method: string; arg: string } | null {
  if (stmt.type !== 'expression_statement') return null
  const call = stmt.namedChildren[0]
  if (!call || call.type !== 'invocation_expression') return null
  const args = getCSharpArguments(call)
  if (args.length !== 1) return null
  return { receiver: getCSharpReceiver(call), method: getCSharpMethodName(call), arg: args[0]!.text }
}

export const csharpRedundantContainsKeyBeforeRemoveVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/redundant-containskey-before-remove',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('alternative')) return null

    const condition = node.childForFieldName('condition')
    if (condition?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(condition) !== 'ContainsKey') return null
    const condArgs = getCSharpArguments(condition)
    if (condArgs.length !== 1) return null
    const guard = { receiver: getCSharpReceiver(condition), arg: condArgs[0]!.text }

    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null
    const stmt = singleStatement(consequence)
    if (!stmt) return null
    const removeCall = callInfo(stmt)
    if (!removeCall || removeCall.method !== 'Remove') return null

    if (removeCall.receiver !== guard.receiver || removeCall.arg !== guard.arg) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Redundant ContainsKey before Remove',
      'Dictionary.Remove already returns false and does nothing when the key is absent, so guarding it with ContainsKey performs a second, wasted lookup.',
      sourceCode,
      'Call Remove(key) directly (use its bool return value if you need to know whether it removed anything).',
    )
  },
}
