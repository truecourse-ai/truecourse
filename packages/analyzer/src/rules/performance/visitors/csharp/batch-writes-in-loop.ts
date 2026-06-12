import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { usesDapper, usesEfCore } from '../../../_shared/csharp-framework-detection.js'
import { getCSharpChainRoot, isInsideCSharpLoop } from './_helpers.js'

/**
 * Per-iteration database round-trips:
 *   - EF Core `SaveChanges()/SaveChangesAsync()` inside a loop (one
 *     transaction per row instead of one batch)
 *   - Dapper `Execute/Query*` on a connection-ish receiver inside a loop
 *     (gated on a `using Dapper;` directive)
 *   - ADO.NET `ExecuteNonQuery()` inside a loop
 *   - EF Core async query operators (`ToListAsync`, `FirstOrDefaultAsync`, …)
 *     inside a loop — the N+1 query shape (gated on the EF Core using)
 */
const EF_SAVE_METHODS = new Set(['SaveChanges', 'SaveChangesAsync'])
const ADO_WRITE_METHODS = new Set(['ExecuteNonQuery', 'ExecuteNonQueryAsync'])
const DAPPER_METHODS = new Set([
  'Execute', 'ExecuteAsync', 'ExecuteScalar', 'ExecuteScalarAsync',
  'Query', 'QueryAsync', 'QueryFirst', 'QueryFirstAsync',
  'QueryFirstOrDefault', 'QueryFirstOrDefaultAsync',
  'QuerySingle', 'QuerySingleAsync', 'QuerySingleOrDefault', 'QuerySingleOrDefaultAsync',
])
const EF_QUERY_METHODS = new Set([
  'ToListAsync', 'ToArrayAsync', 'FirstAsync', 'FirstOrDefaultAsync',
  'SingleAsync', 'SingleOrDefaultAsync', 'AnyAsync', 'CountAsync',
])

// Dapper extension methods hang off IDbConnection — require the chain root to
// look like a connection/db object so `policy.Execute(...)` (Polly and
// friends) does not fire.
const CONNECTION_ROOT_RE = /conn|db|sql|database|session|^tx$|transaction/i

export const csharpBatchWritesInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/batch-writes-in-loop',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!method) return null
    if (getCSharpReceiver(node) === '') return null
    if (!isInsideCSharpLoop(node)) return null

    let kind: 'write' | 'query' | null = null
    if (EF_SAVE_METHODS.has(method) || ADO_WRITE_METHODS.has(method)) {
      kind = 'write'
    } else if (DAPPER_METHODS.has(method) && usesDapper(node)) {
      const root = getCSharpChainRoot(node)
      if (root.type !== 'identifier' || !CONNECTION_ROOT_RE.test(root.text)) return null
      kind = method.startsWith('Query') ? 'query' : 'write'
    } else if (EF_QUERY_METHODS.has(method) && usesEfCore(node)) {
      kind = 'query'
    }
    if (!kind) return null

    if (kind === 'write') {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Database write inside loop',
        `${method}() inside a loop performs one database round-trip per iteration. Batch the writes instead.`,
        sourceCode,
        method.startsWith('SaveChanges')
          ? 'Move SaveChanges() after the loop — EF Core batches all tracked changes in one call.'
          : 'Batch the statements: Dapper Execute() accepts a list parameter, or build one multi-row statement.',
      )
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Database query inside loop (N+1)',
      `${method}() inside a loop issues one query per iteration — the N+1 query pattern. Fetch the data in a single query before the loop.`,
      sourceCode,
      'Load all needed rows in one query before the loop (e.g. Where(x => ids.Contains(x.Id)) or a join), then look them up in memory.',
    )
  },
}
