import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpArguments, getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCSharpChainRoot } from './_helpers.js'

/**
 * `xs.OrderBy(...).First()` sorts the whole sequence — O(n log n) — to take
 * one element when `Min/MinBy` (or `Max/MaxBy`) is O(n).
 *
 * Chains rooted in something that looks like a DbContext/IQueryable source
 * are skipped: EF translates OrderBy().First() to `ORDER BY ... LIMIT 1`,
 * which the database optimizes — rewriting to MinBy there would be wrong.
 */
const TERMINAL_METHODS = new Set(['First', 'FirstOrDefault', 'Last', 'LastOrDefault'])
const DB_ROOT_RE = /^_?(db|ctx|context|dbContext|dataContext|session|query|queryable)$|Context$|Db$/i

export const csharpSortedForMinMaxVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/sorted-for-min-max',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!TERMINAL_METHODS.has(method)) return null
    if (getCSharpArguments(node).length !== 0) return null

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const inner = fn.childForFieldName('expression')
    if (inner?.type !== 'invocation_expression') return null
    const innerMethod = getCSharpMethodName(inner)
    if (innerMethod !== 'OrderBy' && innerMethod !== 'OrderByDescending') return null

    const root = getCSharpChainRoot(node)
    if (root.type === 'identifier' && DB_ROOT_RE.test(root.text)) return null

    const ascending = innerMethod === 'OrderBy'
    const takesFirst = method.startsWith('First')
    const target = ascending === takesFirst ? 'MinBy' : 'MaxBy'

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      `${innerMethod}().${method}() instead of ${target}()`,
      `${innerMethod}(...).${method}() sorts the entire sequence (O(n log n)) to take a single element. ${target}() finds it in O(n).`,
      sourceCode,
      `Replace ${innerMethod}(keySelector).${method}() with ${target}(keySelector).`,
    )
  },
}
