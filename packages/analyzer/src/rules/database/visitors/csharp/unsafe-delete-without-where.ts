import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { usesEfCore } from '../../../_shared/csharp-framework-detection.js'
import { CSHARP_SQL_NODE_TYPES, getCSharpSqlString } from './_helpers.js'

/**
 * Two C# shapes of "DELETE/UPDATE every row in the table":
 *
 *  1. Raw SQL without a WHERE clause passed to Dapper / EF raw SQL /
 *     an ADO.NET command (`conn.Execute("DELETE FROM logs")`).
 *  2. EF Core bulk operators called on an unfiltered set:
 *     `_db.Users.ExecuteDeleteAsync()` / `_db.Set<User>().ExecuteUpdate(…)`
 *     with no `.Where(…)` anywhere in the operator chain.
 */

const EF_BULK_METHODS = new Set([
  'ExecuteDelete', 'ExecuteDeleteAsync', 'ExecuteUpdate', 'ExecuteUpdateAsync',
])

/**
 * Walk the operator chain below an ExecuteDelete/ExecuteUpdate receiver.
 * Returns:
 *  - true  — a `.Where(…)` filters the set
 *  - false — the chain is fully visible down to a root identifier
 *            (`_db.Users.AsNoTracking()…`) and contains no filter
 *  - null  — the chain passes through something we cannot see (a bare
 *            query variable, a method result, …) — the caller must skip
 */
function chainHasWhere(receiver: SyntaxNode): boolean | null {
  // A bare identifier receiver is a pre-built query variable — it may have
  // been filtered where it was built.
  if (receiver.type === 'identifier') return null

  let cur: SyntaxNode | null = receiver
  while (cur) {
    if (cur.type === 'invocation_expression') {
      if (getCSharpMethodName(cur) === 'Where') return true
      const fn = cur.childForFieldName('function')
      cur = fn?.type === 'member_access_expression' ? fn.childForFieldName('expression') : null
      continue
    }
    if (cur.type === 'member_access_expression') {
      cur = cur.childForFieldName('expression')
      continue
    }
    if (cur.type === 'identifier') return false // root reached, chain fully visible
    return null
  }
  return null
}

export const csharpUnsafeDeleteWithoutWhereVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/unsafe-delete-without-where',
  languages: ['csharp'],
  nodeTypes: [...CSHARP_SQL_NODE_TYPES],
  visit(node, filePath, sourceCode) {
    // Shape 2: EF Core bulk operators on an unfiltered set.
    if (node.type === 'invocation_expression') {
      const methodName = getCSharpMethodName(node)
      if (EF_BULK_METHODS.has(methodName) && usesEfCore(node)) {
        const fn = node.childForFieldName('function')
        const receiver = fn?.type === 'member_access_expression' ? fn.childForFieldName('expression') : null
        if (receiver && chainHasWhere(receiver) === false) {
          const isDelete = methodName.startsWith('ExecuteDelete')
          const stmtType = isDelete ? 'DELETE' : 'UPDATE'
          return makeViolation(
            this.ruleKey, node, filePath, 'critical',
            `${stmtType} without WHERE clause`,
            `${methodName}() called on an unfiltered set — this will ${isDelete ? 'delete' : 'update'} every row in the table. Add a .Where(…) before the bulk operation.`,
            sourceCode,
            `Add a .Where(…) filter before ${methodName}() to limit which rows are affected.`,
          )
        }
      }
    }

    // Shape 1: raw SQL without WHERE.
    const sql = getCSharpSqlString(node)
    if (!sql) return null
    const sqlText = sql.toLowerCase()

    const isDeleteOrUpdate = /^\s*(delete\s+from|update\s+\S+\s+set)/.test(sqlText)
    if (!isDeleteOrUpdate) return null

    if (/\bwhere\b/.test(sqlText)) return null

    const isDelete = /^\s*delete\s+from/.test(sqlText)
    const stmtType = isDelete ? 'DELETE' : 'UPDATE'

    return makeViolation(
      this.ruleKey, node, filePath, 'critical',
      `${stmtType} without WHERE clause`,
      `${stmtType} statement has no WHERE condition — this will affect every row in the table.`,
      sourceCode,
      `Add a WHERE clause to limit which rows are affected, or use a TRUNCATE statement intentionally.`,
    )
  },
}
