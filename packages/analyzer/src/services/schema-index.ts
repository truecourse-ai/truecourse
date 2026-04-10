/**
 * Project-wide schema index for visitors that need to know whether a column
 * has a UNIQUE constraint, is a primary key, etc.
 *
 * This wraps the existing `databaseResult` produced by `database-detector.ts`
 * (which runs Drizzle/Prisma/SQLAlchemy parsers over the project's files) and
 * exposes O(1) lookups by `<table>.<column>`.
 *
 * Visitors that need this index opt in via `needsSchemaIndex: true` on the
 * `CodeRuleVisitor` interface. The pipeline builds the index once per
 * analysis and passes it through `walkAstWithVisitors`.
 *
 * Replaces the old `COMMONLY_UNIQUE_FIELDS` hardcoded set + the loose
 * `columnHasUniqueConstraint` text-search heuristic in
 * `missing-unique-constraint`. With this index, the rule can answer "is
 * `users.email` unique?" with real schema data instead of name guessing.
 */
import type { DatabaseDetectionResult, ColumnInfo } from '@truecourse/shared'

export interface SchemaIndex {
  /**
   * Look up a column by `<table>.<column>`. Returns the ColumnInfo from the
   * detected schema, or `null` if the table/column isn't in any parsed schema.
   */
  getColumn(table: string, column: string): ColumnInfo | null

  /**
   * Look up by column name only — used as a fallback when the caller doesn't
   * know the table (e.g. extracting only the column from a query). Returns
   * ALL matching columns across tables; the caller should decide what to do
   * with multiple matches.
   */
  findColumnByName(column: string): Array<{ table: string; column: ColumnInfo }>

  /**
   * Returns true if at least one schema was found in the project. Visitors
   * use this to distinguish "no schema available, conservative skip" from
   * "schema present, this column is genuinely not in it".
   */
  hasSchemas(): boolean

  /** Returns true if the column is unique (via PK or @unique/.unique()). */
  isColumnUnique(table: string, column: string): boolean
}

/**
 * Build a SchemaIndex from the analyzer's existing `databaseResult`.
 * Cheap — just walks the already-parsed table data and builds lookup maps.
 *
 * Stores tables under lowercased keys so the index handles ORM naming
 * conventions where the schema-side and the query-side differ in case:
 *   - Prisma: model `User` → `prisma.user.findFirst(...)`
 *   - Drizzle: `pgTable('users', ...)` → `db.users.findFirst(...)`
 *   - Sequelize: `sequelize.define('User', ...)` → `User.findOne(...)`
 *
 * Lookups normalize the input the same way before looking up.
 */
export function buildSchemaIndex(databaseResult: DatabaseDetectionResult | undefined): SchemaIndex {
  // lowercased(table) → column → ColumnInfo
  const byTable = new Map<string, Map<string, ColumnInfo>>()
  // column name → list of (table, ColumnInfo) for cross-table fallback lookups
  const byColumnName = new Map<string, Array<{ table: string; column: ColumnInfo }>>()

  if (databaseResult) {
    for (const db of databaseResult.databases) {
      for (const table of db.tables) {
        // Build per-table column map
        const cols = new Map<string, ColumnInfo>()
        for (const col of table.columns) {
          cols.set(col.name, col)

          let list = byColumnName.get(col.name)
          if (!list) {
            list = []
            byColumnName.set(col.name, list)
          }
          list.push({ table: table.name, column: col })
        }

        // Store under the canonical SQL name and any aliases (e.g., Drizzle's
        // JS variable name `salesPeople` for the SQL name `sales_people`).
        // All keys are lowercased for case-insensitive lookup.
        const allKeys = [table.name, ...(table.aliases ?? [])]
        for (const key of allKeys) {
          byTable.set(key.toLowerCase(), cols)
        }
      }
    }
  }

  // Pre-compute hasSchemas once
  const hasSchemasResult = byTable.size > 0

  function normalizeTable(name: string): string {
    return name.toLowerCase()
  }

  return {
    getColumn(table: string, column: string): ColumnInfo | null {
      return byTable.get(normalizeTable(table))?.get(column) ?? null
    },

    findColumnByName(column: string) {
      return byColumnName.get(column) ?? []
    },

    hasSchemas() {
      return hasSchemasResult
    },

    isColumnUnique(table: string, column: string): boolean {
      const col = byTable.get(normalizeTable(table))?.get(column)
      if (!col) return false
      return col.isUnique === true || col.isPrimaryKey === true
    },
  }
}

/** An empty SchemaIndex used as a fallback when no databaseResult is available. */
export const EMPTY_SCHEMA_INDEX: SchemaIndex = buildSchemaIndex(undefined)
