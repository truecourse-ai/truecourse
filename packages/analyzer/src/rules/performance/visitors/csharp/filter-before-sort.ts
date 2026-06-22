import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'

/**
 * `xs.OrderBy(k).Where(p)` sorts the whole sequence and only then drops the
 * elements the filter rejects, paying to order items that are immediately
 * discarded. Filtering first (`Where(p).OrderBy(k)`) sorts a smaller set.
 * Fires when a `Where` call's direct receiver is an `OrderBy`/`OrderByDescending`
 * call.
 */
const ORDER_METHODS = new Set(['OrderBy', 'OrderByDescending'])

function receiverInvocation(invocation: SyntaxNode): SyntaxNode | null {
  const fn = invocation.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return null
  const expr = fn.childForFieldName('expression')
  return expr?.type === 'invocation_expression' ? expr : null
}

export const csharpFilterBeforeSortVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/filter-before-sort',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (getCSharpMethodName(node) !== 'Where') return null
    const inner = receiverInvocation(node)
    if (!inner || !ORDER_METHODS.has(getCSharpMethodName(inner))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Filter the collection before sorting',
      'OrderBy followed by Where sorts elements that the filter then discards. Applying Where before OrderBy sorts a smaller sequence.',
      sourceCode,
      'Move the Where call before OrderBy so only the retained elements are sorted.',
    )
  },
}
