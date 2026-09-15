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

  // Pre-process: join multi-line statements (mapped_column(...), Column(...), relationship(...))
  // so each statement is on a single line for regex matching.
  const rawLines = content.split('\n')
  const lines: string[] = []
  let pending = ''
  let parenDepth = 0
  for (const raw of rawLines) {
    if (parenDepth > 0) {
      pending += ' ' + raw.trim()
      for (const ch of raw) {
        if (ch === '(') parenDepth++
        else if (ch === ')') parenDepth--
      }
      if (parenDepth <= 0) {
        lines.push(pending)
        pending = ''
        parenDepth = 0
      }
    } else {
      // Count parens to detect multi-line statements
      let depth = 0
      for (const ch of raw) {
        if (ch === '(') depth++
        else if (ch === ')') depth--
      }
      if (depth > 0) {
        pending = raw
        parenDepth = depth
      } else {
        lines.push(raw)
      }
    }
  }
  if (pending) lines.push(pending)

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
    // Detect mapped_column() definition (SQLAlchemy 2.0):
    //   name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    //   name: Mapped[str] = mapped_column(String(255))
    // Uses balanced bracket extraction since Mapped types can be nested (e.g., Mapped[Optional[List[str]]])
    let mappedColMatch: RegExpMatchArray | null = null
    if (!columnMatch) {
      const mcPrefix = trimmed.match(/^(\w+)\s*:\s*Mapped\[/)
      if (mcPrefix) {
        const afterMapped = trimmed.slice(mcPrefix[0].length)
        let depth = 1, idx = 0
        while (idx < afterMapped.length && depth > 0) {
          if (afterMapped[idx] === '[') depth++
          else if (afterMapped[idx] === ']') depth--
          idx++
        }
        if (depth === 0) {
          const mappedTypeStr = afterMapped.slice(0, idx - 1)
          const rest = afterMapped.slice(idx)
          const argsMatch = rest.match(/^\s*=\s*mapped_column\((.+)\)/)
          if (argsMatch) {
            mappedColMatch = [trimmed, mcPrefix[1], mappedTypeStr, argsMatch[1]] as unknown as RegExpMatchArray
          }
        }
      }
    }

    const colMatch = columnMatch || mappedColMatch
    if (colMatch) {
      const colName = colMatch[1]
      const colArgs = columnMatch ? colMatch[2] : colMatch[3]
      const mappedType = mappedColMatch ? colMatch[2] : null

      const colType = mappedType
        ? mapMappedType(mappedType, colArgs)
        : mapSqlAlchemyType(colArgs)
      const isPrimaryKey = colArgs.includes('primary_key=True')
      const isNullable = mappedType
        ? /Optional|None/.test(mappedType)
        : (colArgs.includes('nullable=True') || (!colArgs.includes('nullable=False') && !isPrimaryKey))

      // Detect ForeignKey
      const fkMatch = colArgs.match(/ForeignKey\(["'](\w+)\.(\w+)["'][^)]*\)/)
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
    // Supports both: name = relationship("Model", ...) and name: Mapped["Model"] = relationship(...)
    const relMatch = trimmed.match(/^(\w+)\s*(?::\s*Mapped\[[^\]]+\]\s*)?=\s*relationship\(["'](\w+)["']/)
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

/**
 * Map SQLAlchemy 2.0 Mapped[type] annotation + mapped_column args to a type string.
 * Uses the mapped_column args first (e.g., BigInteger, String(255)), falls back to Mapped type.
 */
function mapMappedType(mappedType: string, colArgs: string): string {
  // Try to get type from mapped_column args first (more specific)
  const argType = mapSqlAlchemyType(colArgs)
  if (argType && argType !== colArgs.split(',')[0].trim()) {
    return argType
  }

  // Fall back to Mapped type annotation
  // Strip Optional[], List[], etc.
  const inner = mappedType
    .replace(/Optional\[([^\]]+)\]/, '$1')
    .replace(/List\[([^\]]+)\]/, '$1[]')
    .replace(/Dict\[([^\]]+)\]/, 'Json')
    .replace(/list\[([^\]]+)\]/, '$1[]')
    .replace(/dict\[([^\]]+)\]/, 'Json')
    .trim()

  const pyTypeMap: Record<string, string> = {
    'str': 'String',
    'int': 'Int',
    'float': 'Float',
    'bool': 'Boolean',
    'datetime': 'DateTime',
    'date': 'Date',
    'bytes': 'Bytes',
  }

  return pyTypeMap[inner] || argType || inner
}
