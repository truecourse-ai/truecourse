import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const ORDER_METHODS = new Set(['OrderBy', 'OrderByDescending'])

/** The method name of an invocation whose function is a member access, else null. */
function invokedMethodName(invocation: SyntaxNode): string | null {
  const fn = invocation.childForFieldName('function')
  if (fn?.type !== 'member_access_expression') return null
  return fn.childForFieldName('name')?.text ?? null
}

/**
 * `seq.OrderBy(a).OrderBy(b)` — the second `OrderBy`/`OrderByDescending`
 * re-sorts the whole sequence from scratch, discarding the first sort entirely
 * instead of refining it. A secondary sort key must use `ThenBy`/
 * `ThenByDescending`, which preserves the primary ordering.
 */
export const csharpChainedOrderByLosesOrderingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/chained-orderby-loses-ordering',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = invokedMethodName(node)
    if (!method || !ORDER_METHODS.has(method)) return null

    // The receiver of this OrderBy is `<inner>.OrderBy`; inner must itself be
    // an OrderBy invocation for the ordering to be lost.
    const memberAccess = node.childForFieldName('function')!
    const receiver = memberAccess.childForFieldName('expression')
    if (receiver?.type !== 'invocation_expression') return null

    const innerMethod = invokedMethodName(receiver)
    if (!innerMethod || !ORDER_METHODS.has(innerMethod)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Second OrderBy discards the first ordering',
      `Chaining \`${method}\` after \`${innerMethod}\` re-sorts the whole sequence and throws away the first sort; the secondary key never refines the primary one.`,
      sourceCode,
      `Use \`ThenBy\`/\`ThenByDescending\` for the secondary sort key instead of a second \`${method}\`.`,
    )
  },
}
