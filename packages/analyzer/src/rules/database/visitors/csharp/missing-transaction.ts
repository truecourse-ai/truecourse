import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  getCSharpMethodName,
  getCSharpReceiver,
  getCSharpArguments,
  getCSharpEnclosingFunctionBody,
  isCSharpStringNode,
} from '../../../_shared/csharp-helpers.js'
import { usesEfCore } from '../../../_shared/csharp-framework-detection.js'
import { expressionHasDbToken, getCSharpSqlText } from './_helpers.js'

/**
 * Multiple database round-trip writes in one method with no transaction
 * scope. In C# the round-trip writes are:
 *
 *  - EF Core `SaveChanges()`/`SaveChangesAsync()` — each call is its own
 *    commit, so two of them (or one plus a raw write) are not atomic.
 *    `Add`/`Update`/`Remove` only stage changes and are NOT counted.
 *  - ADO.NET `ExecuteNonQuery()`/`ExecuteNonQueryAsync()`.
 *  - EF Core `ExecuteSqlRaw`/`ExecuteSqlInterpolated`/`ExecuteSql` and
 *    Dapper `Execute`/`ExecuteAsync` carrying INSERT/UPDATE/DELETE SQL.
 *
 * Transaction scopes recognized (by body text): TransactionScope,
 * BeginTransaction/UseTransaction (IDbContextTransaction, SqlTransaction),
 * Commit/Rollback calls, and EF execution strategies.
 */

const SAVE_CHANGES_METHODS = new Set(['SaveChanges', 'SaveChangesAsync'])
const ADO_WRITE_METHODS = new Set(['ExecuteNonQuery', 'ExecuteNonQueryAsync'])
const EF_RAW_SQL_METHODS = new Set([
  'ExecuteSqlRaw', 'ExecuteSqlRawAsync',
  'ExecuteSqlInterpolated', 'ExecuteSqlInterpolatedAsync',
  'ExecuteSql', 'ExecuteSqlAsync',
])
const DAPPER_EXECUTE_METHODS = new Set(['Execute', 'ExecuteAsync'])

const WRITE_SQL_RE = /\b(insert|update|delete|merge|replace)\b/

function firstSqlArgText(n: SyntaxNode): string | null {
  const firstArg = getCSharpArguments(n)[0]
  if (!firstArg || !isCSharpStringNode(firstArg)) return null
  return getCSharpSqlText(firstArg)
}

function isCSharpDbWriteCall(n: SyntaxNode, efCoreFile: boolean): boolean {
  if (n.type !== 'invocation_expression') return false
  const name = getCSharpMethodName(n)

  if (SAVE_CHANGES_METHODS.has(name)) {
    // SaveChanges exists on non-EF objects too — require either EF Core in
    // the file or a context-shaped receiver (_db, _context, dbContext, …).
    return efCoreFile || expressionHasDbToken(getCSharpReceiver(n))
  }

  if (ADO_WRITE_METHODS.has(name)) return true

  if (EF_RAW_SQL_METHODS.has(name)) {
    const sql = firstSqlArgText(n)
    // ExecuteSql* is non-query by contract; when the SQL is visible, make
    // sure it is actually a write (not e.g. ANALYZE / a maintenance call).
    return sql === null || WRITE_SQL_RE.test(sql.toLowerCase())
  }

  if (DAPPER_EXECUTE_METHODS.has(name)) {
    // `Execute` is too generic a name — only count it when the SQL literal
    // is visible and is a write.
    const sql = firstSqlArgText(n)
    return sql !== null && WRITE_SQL_RE.test(sql.toLowerCase())
  }

  return false
}

export const csharpMissingTransactionVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-transaction',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const efCoreFile = usesEfCore(node)
    if (!isCSharpDbWriteCall(node, efCoreFile)) return null

    const body = getCSharpEnclosingFunctionBody(node)
    if (!body) return null

    // Any transaction machinery in the method ⇒ assume the writes are scoped.
    // TransactionScope / BeginTransaction / UseTransaction / IDbContextTransaction
    // all contain "transaction"; Commit()/Rollback() imply one exists; EF
    // execution strategies wrap their delegate transactionally.
    const bodyText = body.text.toLowerCase()
    if (/transaction|commit\s*\(|rollback|executionstrategy/.test(bodyText)) return null

    // Count round-trip writes in the body; report only on the second+
    // occurrence so one method yields one violation.
    let writeCount = 0
    let seenSelf = false
    let isSecondOccurrence = false

    function countWrites(n: SyntaxNode) {
      if (n.type === 'invocation_expression' && isCSharpDbWriteCall(n, efCoreFile)) {
        writeCount++
        if (n.id === node.id) {
          seenSelf = true
        } else if (seenSelf) {
          isSecondOccurrence = true
        }
      }
      for (const child of n.namedChildren) {
        if (child) countWrites(child)
      }
    }

    countWrites(body)

    if (writeCount >= 2 && isSecondOccurrence) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Multiple writes without transaction',
        `Found ${writeCount} database write operations in the same method without a transaction. If one fails, earlier writes will not be rolled back.`,
        sourceCode,
        'Wrap the related writes in a transaction (TransactionScope, context.Database.BeginTransaction(), or a single SaveChanges call).',
      )
    }

    return null
  },
}
