import type { TableInfo, ColumnInfo, RelationInfo } from '@truecourse/shared'

/**
 * Parse a Drizzle schema TypeScript file and extract tables and relations.
 *
 * Uses a manual brace counter (not regex) to extract the columns block,
 * because Drizzle column declarations like
 *   `userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' })`
 * contain braces nested inside parens. A naive regex with `\{...\}`
 * stops at the first close brace, missing later columns.
 */
export function parseDrizzleSchema(sourceCode: string): {
  tables: TableInfo[]
  relations: RelationInfo[]
} {
  const tables: TableInfo[] = []
  const relations: RelationInfo[] = []

  // Find the start of each pgTable/mysqlTable/sqliteTable call.
  // Pattern: export const xxx = pgTable('table_name', { ... })
  const headerPattern = /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:pgTable|mysqlTable|sqliteTable)\s*\(\s*['"](\w+)['"]\s*,\s*\{/g

  let header
  while ((header = headerPattern.exec(sourceCode)) !== null) {
    const variableName = header[1]!  // e.g. `salesPeople` from `export const salesPeople = pgTable(...)`
    const tableName = header[2]!     // e.g. `sales_people` from `pgTable('sales_people', ...)`
    // header.index is the start of the export statement; the open `{` is the
    // last character of the matched header, so block content starts right after.
    const blockStart = header.index + header[0]!.length
    const columnsBlock = extractBalancedBlock(sourceCode, blockStart)
    if (columnsBlock === null) continue

    const columns = parseDrizzleColumns(columnsBlock)
    const primaryKey = columns.find((c) => c.isPrimaryKey)?.name

    // Store both the SQL name and the JS variable name. Drizzle queries use
    // the variable name (`db.query.salesPeople.findFirst(...)`), while the
    // SQL name (`sales_people`) is what migrations and tools see.
    const aliases = variableName !== tableName ? [variableName] : undefined

    tables.push({
      name: tableName,
      columns,
      primaryKey,
      aliases,
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

/**
 * Walk the source from `start` (the position right after an opening `{`)
 * counting brace depth, and return the substring up to the matching close.
 *
 * Strings (single, double, backtick) and comments are ignored so that braces
 * inside string literals don't throw off the counter. Returns null if no
 * matching close is found.
 */
function extractBalancedBlock(source: string, start: number): string | null {
  let depth = 1
  let i = start
  while (i < source.length) {
    const ch = source[i]!

    // Skip string literals (single/double/backtick)
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i++
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue }
        if (source[i] === quote) { i++; break }
        i++
      }
      continue
    }

    // Skip line comments
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i++
      continue
    }

    // Skip block comments
    if (ch === '/' && source[i + 1] === '*') {
      i += 2
      while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++
      i += 2
      continue
    }

    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return source.slice(start, i)
      }
    }
    i++
  }
  return null
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
    // Drizzle marks unique columns via `.unique()` or `.unique('constraint_name')`.
    // PKs are inherently unique — represented separately via isPrimaryKey.
    const isUnique = /\.unique\s*\(/.test(chain)

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
      isUnique: isUnique || undefined,
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
