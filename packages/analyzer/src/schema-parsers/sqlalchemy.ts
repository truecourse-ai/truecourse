import type { TableInfo, ColumnInfo, RelationInfo } from '@truecourse/shared'

/**
 * Parse a SQLAlchemy model file and extract tables and relations.
 *
 * Detects classes with __tablename__ and Column() definitions.
 * Supports: Column types, primary_key, nullable, ForeignKey, relationship().
 */
export function parseSqlAlchemySchema(content: string): {
  tables: TableInfo[]
  relations: RelationInfo[]
} {
  const tables: TableInfo[] = []
  const relations: RelationInfo[] = []

  const lines = content.split('\n')

  // First pass: build class name → __tablename__ map
  const classToTable = new Map<string, string>()
  {
    let cls: string | null = null
    for (const line of lines) {
      const trimmed = line.trimStart()
      const classMatch = trimmed.match(/^class\s+(\w+)\s*\(/)
      if (classMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
        cls = classMatch[1]
        continue
      }
      if (cls) {
        const tableMatch = trimmed.match(/__tablename__\s*=\s*["'](\w+)["']/)
        if (tableMatch) {
          classToTable.set(cls, tableMatch[1])
        }
      }
    }
  }

  // Second pass: extract columns, relations
  let currentClass: string | null = null
  let currentTableName: string | null = null
  let currentColumns: ColumnInfo[] = []
  let primaryKey: string | undefined
  let indentLevel = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trimStart()

    // Detect class definition: class User(Base):
    const classMatch = trimmed.match(/^class\s+(\w+)\s*\(/)
    if (classMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
      // Save previous class if it had a table name
      if (currentClass && currentTableName) {
        tables.push({
          name: currentTableName,
          columns: currentColumns,
          primaryKey,
        })
      }

      currentClass = classMatch[1]
      currentTableName = null
      currentColumns = []
      primaryKey = undefined
      indentLevel = line.length - trimmed.length + 4 // expect 4-space indent for body
      continue
    }

    if (!currentClass) continue

    // Detect __tablename__
    const tableNameMatch = trimmed.match(/__tablename__\s*=\s*["'](\w+)["']/)
    if (tableNameMatch) {
      currentTableName = tableNameMatch[1]
      continue
    }

    // Skip non-indented lines (end of class)
    if (trimmed.length > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
      // Save previous class
      if (currentTableName) {
        tables.push({
          name: currentTableName,
          columns: currentColumns,
          primaryKey,
        })
      }
      currentClass = null
      currentTableName = null
      currentColumns = []
      primaryKey = undefined

      // Re-process this line (might be a new class)
      const newClassMatch = trimmed.match(/^class\s+(\w+)\s*\(/)
      if (newClassMatch) {
        currentClass = newClassMatch[1]
        indentLevel = 4
      }
      continue
    }

    // Detect Column() definition: name = Column(Type, ...)
    const columnMatch = trimmed.match(/^(\w+)\s*=\s*Column\((.+)\)/)
    if (columnMatch) {
      const colName = columnMatch[1]
      const colArgs = columnMatch[2]

      const colType = mapSqlAlchemyType(colArgs)
      const isPrimaryKey = colArgs.includes('primary_key=True')
      const isNullable = colArgs.includes('nullable=True') || (!colArgs.includes('nullable=False') && !isPrimaryKey)

      // Detect ForeignKey
      const fkMatch = colArgs.match(/ForeignKey\(["'](\w+)\.(\w+)["']\)/)
      const isForeignKey = !!fkMatch
      const referencesTable = fkMatch?.[1]
      const referencesColumn = fkMatch?.[2]

      // Detect default value
      let defaultValue: string | undefined
      const defaultMatch = colArgs.match(/(?:default|server_default)=([^,)]+)/)
      if (defaultMatch) {
        defaultValue = defaultMatch[1].trim()
      }

      if (isPrimaryKey) {
        primaryKey = colName
      }

      currentColumns.push({
        name: colName,
        type: colType,
        isNullable: isNullable && !isPrimaryKey,
        isPrimaryKey,
        defaultValue,
        isForeignKey,
        referencesTable,
        referencesColumn,
      })

      // Add relation for foreign keys
      if (isForeignKey && referencesTable && currentTableName) {
        relations.push({
          sourceTable: currentTableName,
          targetTable: referencesTable,
          relationType: 'one-to-many',
          foreignKeyColumn: colName,
          foreignKeyReferencesColumn: referencesColumn,
        })
      }

      continue
    }

    // Detect relationship() — for relation mapping (not a column)
    const relMatch = trimmed.match(/^(\w+)\s*=\s*relationship\(["'](\w+)["']/)
    if (relMatch && currentTableName) {
      const targetModel = relMatch[2]
      const targetTable = classToTable.get(targetModel)
      if (targetTable) {
        const hasBackPopulates = trimmed.includes('back_populates')
        if (hasBackPopulates) {
          relations.push({
            sourceTable: currentTableName,
            targetTable,
            relationType: 'one-to-many',
            foreignKeyColumn: relMatch[1],
          })
        }
      }
    }
  }

  // Save last class
  if (currentClass && currentTableName) {
    tables.push({
      name: currentTableName,
      columns: currentColumns,
      primaryKey,
    })
  }

  return { tables, relations }
}

/**
 * Map SQLAlchemy Column type argument to a simple type string.
 */
function mapSqlAlchemyType(colArgs: string): string {
  const firstArg = colArgs.split(',')[0].trim()

  const typeMap: Record<string, string> = {
    'String': 'String',
    'Integer': 'Int',
    'Float': 'Float',
    'Boolean': 'Boolean',
    'DateTime': 'DateTime',
    'Date': 'Date',
    'Time': 'Time',
    'Text': 'String',
    'BigInteger': 'BigInt',
    'SmallInteger': 'Int',
    'Numeric': 'Decimal',
    'JSON': 'Json',
    'LargeBinary': 'Bytes',
  }

  return typeMap[firstArg] || firstArg
}
