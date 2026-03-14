import type { TableInfo, ColumnInfo, RelationInfo } from '@truecourse/shared'

/**
 * Parse a Drizzle schema TypeScript file and extract tables and relations.
 * Uses regex-based parsing on the source code.
 */
export function parseDrizzleSchema(sourceCode: string): {
  tables: TableInfo[]
  relations: RelationInfo[]
} {
  const tables: TableInfo[] = []
  const relations: RelationInfo[] = []

  // Find pgTable/mysqlTable/sqliteTable calls
  // Pattern: export const xxx = pgTable('table_name', { ... })
  const tablePattern = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\s*\(\s*['"](\w+)['"]\s*,\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g

  let match
  while ((match = tablePattern.exec(sourceCode)) !== null) {
    const tableName = match[2]!
    const columnsBlock = match[3]!
    const columns = parseDrizzleColumns(columnsBlock)

    const primaryKey = columns.find((c) => c.isPrimaryKey)?.name

    tables.push({
      name: tableName,
      columns,
      primaryKey,
    })
  }

  // Extract relations from .references() calls
  for (const table of tables) {
    for (const col of table.columns) {
      if (col.isForeignKey && col.referencesTable) {
        relations.push({
          sourceTable: table.name,
          targetTable: col.referencesTable,
          relationType: 'one-to-many',
          foreignKeyColumn: col.name,
          foreignKeyReferencesColumn: col.referencesColumn,
        })
      }
    }
  }

  return { tables, relations }
}

function parseDrizzleColumns(block: string): ColumnInfo[] {
  const columns: ColumnInfo[] = []

  // Match column definitions: fieldName: type('col_name').chain()...
  // e.g., id: uuid('id').defaultRandom().primaryKey(),
  // e.g., name: text('name').notNull(),
  // e.g., repoId: uuid('repo_id').notNull().references(() => repos.id, { onDelete: 'cascade' }),
  const colPattern = /(\w+)\s*:\s*(uuid|text|integer|boolean|timestamp|jsonb|varchar|serial|bigint|real|doublePrecision|smallint|numeric|char|date|time|interval)\s*\([^)]*\)([\s\S]*?)(?=,\s*\w+\s*:|$)/g

  let colMatch
  while ((colMatch = colPattern.exec(block)) !== null) {
    const fieldName = colMatch[1]!
    const colType = colMatch[2]!
    const chain = colMatch[3] || ''

    const isPrimaryKey = chain.includes('.primaryKey()')
    const isNotNull = chain.includes('.notNull()')
    const isNullable = !isNotNull && !isPrimaryKey

    // Detect default
    let defaultValue: string | undefined
    const defaultMatch = chain.match(/\.default(?:Random|Now)?\(([^)]*)\)/)
    if (defaultMatch) {
      defaultValue = defaultMatch[0]!.replace(/^\./, '')
    }

    // Detect references
    let isForeignKey = false
    let referencesTable: string | undefined
    let referencesColumn: string | undefined

    const refMatch = chain.match(/\.references\(\s*\(\)\s*=>\s*(\w+)\.(\w+)/)
    if (refMatch) {
      isForeignKey = true
      referencesTable = refMatch[1]!
      referencesColumn = refMatch[2]!
    }

    columns.push({
      name: fieldName,
      type: mapDrizzleType(colType),
      isNullable: isNullable || undefined,
      isPrimaryKey: isPrimaryKey || undefined,
      defaultValue,
      isForeignKey: isForeignKey || undefined,
      referencesTable,
      referencesColumn,
    })
  }

  return columns
}

function mapDrizzleType(type: string): string {
  const typeMap: Record<string, string> = {
    uuid: 'uuid',
    text: 'text',
    integer: 'integer',
    boolean: 'boolean',
    timestamp: 'timestamp',
    jsonb: 'jsonb',
    varchar: 'varchar',
    serial: 'serial',
    bigint: 'bigint',
    real: 'real',
    doublePrecision: 'double',
    smallint: 'smallint',
    numeric: 'numeric',
    char: 'char',
    date: 'date',
    time: 'time',
    interval: 'interval',
  }
  return typeMap[type] || type
}
