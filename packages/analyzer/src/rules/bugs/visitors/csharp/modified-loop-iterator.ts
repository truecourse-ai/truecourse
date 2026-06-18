import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/**
 * Mutating a collection inside the foreach that iterates it
 * (`foreach (var o in orders) { orders.Remove(o); }`) — throws
 * InvalidOperationException ("Collection was modified") for lists and most
 * BCL collections.
 */
const MUTATING_METHODS = new Set([
  'Add', 'AddRange', 'Remove', 'RemoveAt', 'RemoveAll', 'RemoveRange',
  'Clear', 'Insert', 'InsertRange',
])

export const csharpModifiedLoopIteratorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/modified-loop-iterator',
  languages: ['csharp'],
  nodeTypes: ['foreach_statement'],
  visit(node, filePath, sourceCode) {
    const iterExpr = node.childForFieldName('right')
    if (!iterExpr || (iterExpr.type !== 'identifier' && iterExpr.type !== 'member_access_expression')) return null
    const collName = iterExpr.text

    const body = node.childForFieldName('body')
    if (!body) return null

    function findMutation(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'invocation_expression') {
        const method = getCSharpMethodName(n)
        if (MUTATING_METHODS.has(method) && getCSharpReceiver(n) === collName) return n
      }
      if (CSHARP_FUNCTION_BOUNDARIES.has(n.type)) return null
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) {
          const found = findMutation(child)
          if (found) return found
        }
      }
      return null
    }

    const mutation = findMutation(body)
    if (!mutation) return null

    return makeViolation(
      this.ruleKey, mutation, filePath, 'high',
      'Collection modified while iterating',
      `\`${collName}\` is mutated inside the foreach that iterates it — this throws InvalidOperationException ("Collection was modified") at runtime.`,
      sourceCode,
      `Iterate over a snapshot (\`foreach (var x in ${collName}.ToList())\`) or collect the changes and apply them after the loop.`,
    )
  },
}
