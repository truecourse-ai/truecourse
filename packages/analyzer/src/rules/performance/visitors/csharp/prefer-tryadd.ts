import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'

/**
 * `if (!d.ContainsKey(k)) d.Add(k, v);` does two lookups: `TryAdd(k, v)` adds
 * the entry only when absent in a single lookup and returns whether it did.
 * Fires only when the guard is `!ContainsKey(k)` (no else) and the body is
 * exactly the matching `Add(k, ...)` on the same receiver and key, so a guard
 * that does extra work is left alone.
 */
function singleStatement(consequence: SyntaxNode): SyntaxNode | null {
  if (consequence.type === 'expression_statement') return consequence
  if (consequence.type === 'block') {
    const stmts = consequence.namedChildren.filter((c): c is SyntaxNode => !!c && c.type !== 'comment')
    return stmts.length === 1 ? stmts[0]! : null
  }
  return null
}

export const csharpPreferTryAddVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/prefer-tryadd',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    if (node.childForFieldName('alternative')) return null

    // Condition must be `!recv.ContainsKey(key)`.
    const condition = node.childForFieldName('condition')
    if (condition?.type !== 'prefix_unary_expression') return null
    if (condition.children.find((c) => c?.type === '!')?.type !== '!') return null
    const inner = condition.namedChildren.find(Boolean)
    if (inner?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(inner) !== 'ContainsKey') return null
    const containsArgs = getCSharpArguments(inner)
    if (containsArgs.length !== 1) return null
    const guard = { receiver: getCSharpReceiver(inner), key: containsArgs[0]!.text }

    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null
    const stmt = singleStatement(consequence)
    if (!stmt || stmt.type !== 'expression_statement') return null
    const addCall = stmt.namedChildren[0]
    if (!addCall || addCall.type !== 'invocation_expression') return null
    if (getCSharpMethodName(addCall) !== 'Add') return null
    if (getCSharpReceiver(addCall) !== guard.receiver) return null

    // Add(key, value): first argument must be the same key the guard tested.
    const addArgs = getCSharpArguments(addCall)
    if (addArgs.length !== 2) return null
    if (addArgs[0]!.text !== guard.key) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer TryAdd over ContainsKey + Add',
      'Guarding Dictionary.Add with !ContainsKey performs two lookups. TryAdd(key, value) adds the entry only when the key is absent in a single lookup and reports whether it did.',
      sourceCode,
      'Replace the ContainsKey guard and Add with a single TryAdd(key, value) call.',
    )
  },
}
