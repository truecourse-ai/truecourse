import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName, getCSharpReceiver, walkCSharp } from '../../../_shared/csharp-helpers.js'

/**
 * `if (d.ContainsKey(k)) { var v = d[k]; ... }` performs the lookup twice — once
 * to test membership, once via the indexer. `TryGetValue(k, out var v)` does a
 * single lookup. Fires when the guard is `d.ContainsKey(k)` and the body reads
 * the value through `d[k]` with the same receiver and key. Indexer *writes*
 * (`d[k] = …`) don't count, since they aren't a redundant read.
 */
function isIndexerReadOf(node: SyntaxNode, receiver: string, key: string): boolean {
  if (node.type !== 'element_access_expression') return false
  if (node.childForFieldName('expression')?.text !== receiver) return false
  const bracket = node.namedChildren.find((c) => c?.type === 'bracketed_argument_list')
  const argNodes = bracket?.namedChildren.filter((c): c is SyntaxNode => !!c && c.type === 'argument') ?? []
  if (argNodes.length !== 1 || argNodes[0]!.text !== key) return false
  // Exclude assignment targets: `d[k] = ...`.
  const parent = node.parent
  if (parent?.type === 'assignment_expression' && parent.childForFieldName('left')?.id === node.id) return false
  return true
}

export const csharpPreferTryGetValueVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/prefer-trygetvalue',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (condition?.type !== 'invocation_expression') return null
    if (getCSharpMethodName(condition) !== 'ContainsKey') return null
    const condArgs = getCSharpArguments(condition)
    if (condArgs.length !== 1) return null
    const receiver = getCSharpReceiver(condition)
    const key = condArgs[0]!.text
    if (!receiver) return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null

    let readsValue = false
    walkCSharp(consequence, (n) => {
      if (isIndexerReadOf(n, receiver, key)) readsValue = true
    })
    if (!readsValue) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Prefer TryGetValue over ContainsKey + indexer',
      'Guarding an indexer read with ContainsKey looks the key up twice. TryGetValue(key, out var value) does it in a single lookup.',
      sourceCode,
      'Replace the ContainsKey guard and indexer read with TryGetValue(key, out var value).',
    )
  },
}
