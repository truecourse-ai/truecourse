import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_SQL_NODE_TYPES, getCSharpSqlString } from './_helpers.js'

/**
 * DDL executed outside a migration file: `ALTER TABLE` / `CREATE TABLE` /
 * `DROP TABLE` / `CREATE INDEX` SQL passed to Dapper, EF Core raw SQL, or an
 * ADO.NET command from regular application code. EF Core migrations live
 * under `Migrations/` (timestamp-prefixed files) — both are path-skipped.
 */
export const csharpMissingMigrationVisitor: CodeRuleVisitor = {
  ruleKey: 'database/deterministic/missing-migration',
  languages: ['csharp'],
  nodeTypes: [...CSHARP_SQL_NODE_TYPES],
  visit(node, filePath, sourceCode) {
    // Skip migration files: EF Core scaffolds Migrations/20240101120000_Name.cs;
    // FluentMigrator and friends conventionally use Migrations/ folders too.
    if (/migrat/i.test(filePath) || /\d{14}/.test(filePath)) return null

    const sql = getCSharpSqlString(node)
    if (!sql) return null
    const sqlText = sql.toLowerCase()

    if (!/^\s*(alter\s+table|create\s+table|drop\s+table|create\s+(unique\s+)?index|drop\s+index)/.test(sqlText)) {
      return null
    }

    // Idempotent DDL (`IF NOT EXISTS` / `IF EXISTS`) is the standard embedded
    // (e.g. Microsoft.Data.Sqlite) bootstrap pattern — it runs safely on every
    // startup and IS the schema mechanism, not an accidental change.
    if (/if\s+(not\s+)?exists/.test(sqlText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Schema change outside migration file',
      `DDL statement (ALTER TABLE / CREATE TABLE / etc.) found outside a migration. Schema changes should be tracked in migrations.`,
      sourceCode,
      'Move this schema change into a versioned migration (e.g. an EF Core migration).',
    )
  },
}
