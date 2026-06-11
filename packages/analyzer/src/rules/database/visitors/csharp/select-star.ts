import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_SQL_NODE_TYPES, getCSharpSqlString } from './_helpers.js'

/**
 * `SELECT *` in SQL passed to Dapper (`conn.Query<T>("SELECT * …")`),
 * EF Core raw SQL (`FromSqlRaw`, `SqlQueryRaw`), an ADO.NET command
 * constructor (`new SqlCommand("SELECT * …", conn)`), or a
 * `cmd.CommandText = "SELECT * …"` assignment.
 */
export const csharpSelectStarVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/select-star',
  languages: ['csharp'],
  nodeTypes: [...CSHARP_SQL_NODE_TYPES],
  visit(node, filePath, sourceCode) {
    const sql = getCSharpSqlString(node)
    if (!sql) return null

    // Must be a SELECT statement fetching all columns. `SELECT COUNT(*)`
    // does not match — the wildcard must directly follow SELECT.
    if (!/^\s*select\s+\*/.test(sql.toLowerCase())) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'SELECT * in production code',
      `Fetching all columns with SELECT * wastes bandwidth and prevents index-only scans. Specify only the columns you need.`,
      sourceCode,
      'Replace SELECT * with an explicit column list.',
    )
  },
}
