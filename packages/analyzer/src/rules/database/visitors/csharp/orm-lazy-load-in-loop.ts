import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver, getCSharpEnclosingFunctionBody } from '../../../_shared/csharp-helpers.js'
import { detectCSharpOrm } from '../../../_shared/csharp-framework-detection.js'
import {
  isInsideCSharpLoopBody,
  getEnclosingForeachBody,
  chainRootIdentifier,
  findLocalDeclaration,
} from './_helpers.js'

/**
 * N+1 query patterns inside loops, EF Core / NHibernate flavored:
 *
 *  1. Explicit loading per iteration:
 *     `_db.Entry(order).Collection(o => o.Items).Load()` inside a loop.
 *  2. A query on the context inside a loop: `_db.Orders.First(…)` — one
 *     round trip per iteration.
 *  3. A LINQ materializer on a navigation property of the foreach variable
 *     (`order.Items.ToList()` / `order.Items.Count()`) where the foreach
 *     iterates a database query — each enumeration lazy-loads.
 *
 * Without type information pattern 3 only fires when the foreach source is
 * visibly DB-backed (context member chain, query-operator chain, or a local
 * initialized from one) — entity lists arriving via parameters are missed.
 */

const EXPLICIT_LOAD_METHODS = new Set(['Load', 'LoadAsync'])

// LINQ operators that EXECUTE the query / enumerate the navigation.
const MATERIALIZER_METHODS = new Set([
  'ToList', 'ToListAsync', 'ToArray', 'ToArrayAsync',
  'Count', 'CountAsync', 'LongCount', 'LongCountAsync',
  'Any', 'AnyAsync', 'First', 'FirstAsync', 'FirstOrDefault', 'FirstOrDefaultAsync',
  'Single', 'SingleAsync', 'SingleOrDefault', 'SingleOrDefaultAsync',
  'Sum', 'SumAsync', 'Max', 'MaxAsync', 'Min', 'MinAsync', 'Average', 'AverageAsync',
])

/**
 * Identifiers that name a DbContext: `_db`, `db`, `dbContext`, `_appDb`,
 * `database`, `OrdersDbContext`-style fields. Deliberately suffix-anchored —
 * 'dbConfig'/'dbName' must not match, and 'context'/'ctx' alone collide with
 * HttpContext / ValidationContext.
 */
const DB_ROOT_NAME_RE = /^_*(?:db|database|dbContext|\w+Db|\w+Database|\w+DbContext)$/

const QUERY_CHAIN_RE = /\.(?:Where|Include|ThenInclude|AsNoTracking|AsTracking|OrderBy|OrderByDescending|AsQueryable|AsEnumerable|ToList|ToListAsync|ToArray|ToArrayAsync)\s*\(|\.Set<|\.Query<|\.FromSql/

/** Does this expression visibly come from the database? */
function looksDbSourced(expr: SyntaxNode, scopeBody: SyntaxNode | null): boolean {
  if (QUERY_CHAIN_RE.test(expr.text)) return true
  const root = chainRootIdentifier(expr)
  if (root && DB_ROOT_NAME_RE.test(root.text)) return true
  // A bare identifier: resolve its local declaration and inspect the initializer.
  if (expr.type === 'identifier' && scopeBody) {
    const decl = findLocalDeclaration(scopeBody, expr.text)
    if (decl && (QUERY_CHAIN_RE.test(decl.text) || /\b_*(?:db|dbContext|database)\s*\./.test(decl.text))) {
      return true
    }
  }
  return false
}

export const csharpOrmLazyLoadInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/orm-lazy-load-in-loop',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    // Gate on an ORM in the file — ToList()/Count()/Any() are everyday
    // LINQ-to-objects calls in non-database code.
    const orm = detectCSharpOrm(node)
    if (orm !== 'efcore' && orm !== 'nhibernate') return null

    if (!isInsideCSharpLoopBody(node)) return null

    const methodName = getCSharpMethodName(node)

    // Pattern 1: explicit loading — _db.Entry(o).Collection(x => x.Items).Load()
    if (EXPLICIT_LOAD_METHODS.has(methodName)) {
      const receiverText = getCSharpReceiver(node)
      if (/\b(?:Entry|Collection|Reference)\s*\(/.test(receiverText)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'ORM lazy loading in loop (N+1)',
          `${methodName}() explicitly loads a relationship inside a loop — one query per iteration. Eager-load with .Include(…) on the original query instead.`,
          sourceCode,
          'Move the relationship loading out of the loop using .Include(…)/.ThenInclude(…) on the source query.',
        )
      }
      return null
    }

    if (!MATERIALIZER_METHODS.has(methodName)) return null

    const fn = node.childForFieldName('function')
    if (fn?.type !== 'member_access_expression') return null
    const receiverExpr = fn.childForFieldName('expression')
    if (!receiverExpr) return null
    const root = chainRootIdentifier(receiverExpr)
    if (!root) return null

    // Pattern 2: a context query inside the loop — _db.Orders.First(…).
    // Requires at least one member hop below the materializer.
    if (receiverExpr.type !== 'identifier' && DB_ROOT_NAME_RE.test(root.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'ORM query in loop (N+1)',
        `${methodName}() executes a database query inside a loop — one round trip per iteration. Fetch the data once before the loop (or use a join / .Include).`,
        sourceCode,
        'Move the query outside the loop: fetch all needed rows in one query (Where + Contains, join, or Include) and look them up in memory.',
      )
    }

    // Pattern 3: materializer on a navigation property of the foreach variable.
    const foreachNode = getEnclosingForeachBody(node)
    if (!foreachNode) return null
    const loopVar = foreachNode.childForFieldName('left')
    if (loopVar?.type !== 'identifier' || root.text !== loopVar.text) return null
    // Must be a member access ON the loop variable (order.Items…), not the variable itself.
    if (receiverExpr.type === 'identifier') return null

    const iterable = foreachNode.childForFieldName('right')
    if (!iterable) return null
    const scopeBody = getCSharpEnclosingFunctionBody(node)

    // Eagerly-loaded source: if the query the loop iterates carries an
    // .Include(…), enumerating the navigation in the loop is NOT a lazy load.
    const iterableDeclText = iterable.type === 'identifier' && scopeBody
      ? findLocalDeclaration(scopeBody, iterable.text)?.text ?? ''
      : ''
    if (/\.(?:Then)?Include\s*\(/.test(`${iterable.text} ${iterableDeclText}`)) return null

    if (!looksDbSourced(iterable, scopeBody)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'ORM lazy loading in loop (N+1)',
      `Enumerating a navigation property via .${methodName}() inside a loop triggers one query per iteration. Eager-load the relationship with .Include(…) on the source query.`,
      sourceCode,
      'Add .Include(…) (or a projection) to the source query so the relationship is loaded in the initial round trip.',
    )
  },
}
