import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { walkCSharp } from '../../../_shared/csharp-helpers.js'

/**
 * `foreach (var key in dict.Keys)` where the body reads `dict[key]` — each
 * indexer access is a second hash lookup. Iterating the dictionary itself
 * yields KeyValuePairs with both at once.
 *
 * Loops that ASSIGN through the indexer (`dict[key] = ...`) are skipped:
 * iterating .Keys is the correct pattern for updating values in place, since
 * KeyValuePair enumeration cannot write back.
 */
export const csharpIncorrectDictIteratorVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/incorrect-dict-iterator',
  languages: ['csharp'],
  nodeTypes: ['foreach_statement'],
  visit(node, filePath, sourceCode) {
    const right = node.childForFieldName('right')
    if (!right || right.type !== 'member_access_expression') return null
    if (right.childForFieldName('name')?.text !== 'Keys') return null
    const dictText = right.childForFieldName('expression')?.text
    if (!dictText) return null

    const left = node.childForFieldName('left')
    if (!left || left.type !== 'identifier') return null
    const iterVar = left.text

    const body = node.childForFieldName('body')
    if (!body) return null

    let reads = false
    let writes = false
    walkCSharp(body, (n: SyntaxNode) => {
      if (n.type !== 'element_access_expression') return
      if (n.childForFieldName('expression')?.text !== dictText) return
      const subscript = n.childForFieldName('subscript')
      const args = subscript?.namedChildren.filter(Boolean) ?? []
      if (args.length !== 1) return
      const inner = args[0]!.namedChildren[0]
      if (inner?.type !== 'identifier' || inner.text !== iterVar) return

      const parent = n.parent
      if (parent?.type === 'assignment_expression' && parent.childForFieldName('left')?.id === n.id) {
        writes = true
      } else {
        reads = true
      }
    })

    if (!reads || writes) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Iterating .Keys but indexing back into the dictionary',
      `Iterating ${dictText}.Keys and reading ${dictText}[${iterVar}] in the body does a second hash lookup per iteration. Iterate the dictionary directly.`,
      sourceCode,
      `Replace with foreach (var (key, value) in ${dictText}) — or iterate ${dictText}.Values if only the values are needed.`,
    )
  },
}
