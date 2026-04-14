import type { TableInfo, ColumnInfo, RelationInfo } from '@truecourse/shared'

/**
 * Parse a Prisma schema file and extract tables (models) and relations.
 */
export function parsePrismaSchema(content: string): {
  tables: TableInfo[]
  relations: RelationInfo[]
} {
  const tables: TableInfo[] = []
  const relations: RelationInfo[] = []

  const lines = content.split('\n')
  let currentModel: string | null = null
  let currentColumns: ColumnInfo[] = []
  let primaryKey: string | undefined
  let braceDepth = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Skip comments and empty lines
    if (line.startsWith('//') || line === '') continue

    // Detect model block start
    const modelMatch = line.match(/^model\s+(\w+)\s*\{/)
    if (modelMatch) {
      currentModel = modelMatch[1]!
      currentColumns = []
      primaryKey = undefined
      braceDepth = 1
      continue
    }

    // Track brace depth
    if (currentModel) {
      if (line === '}') {
        braceDepth--
        if (braceDepth === 0) {
          tables.push({
            name: currentModel,
            columns: currentColumns,
            primaryKey,
          })
          currentModel = null
          continue
        }
      }

      // Parse field line
      const fieldMatch = line.match(/^(\w+)\s+(\S+)(.*)/)
      if (!fieldMatch) continue

      const fieldName = fieldMatch[1]!
      let fieldType = fieldMatch[2]!
      const rest = fieldMatch[3] || ''

      // Skip relation fields (field type is another model name with [] or ?)
      // But detect relation annotations
      const isArray = fieldType.endsWith('[]')
      const isOptionalRelation = fieldType.endsWith('?')
      const cleanType = fieldType.replace(/[\[\]?]/g, '')

      // Check if this is a @relation field
      const relationMatch = rest.match(/@relation\(fields:\s*\[(\w+)\],\s*references:\s*\[(\w+)\]\)/)

      if (relationMatch) {
        // This field has @relation — it's a foreign key field
        const fkColumn = relationMatch[1]!
        const refColumn = relationMatch[2]!

        relations.push({
          sourceTable: currentModel,
          targetTable: cleanType,
          relationType: 'one-to-many', // will be corrected below
          foreignKeyColumn: fkColumn,
          foreignKeyReferencesColumn: refColumn,
        })
        continue
      }

      if (isArray) {
        // Array relation field like `posts Post[]` — skip as column, relation handled by the other side
        continue
      }

      // Check if it's a scalar type
      const scalarTypes: Record<string, string> = {
        'String': 'text',
        'Int': 'integer',
        'Float': 'float',
        'Boolean': 'boolean',
        'DateTime': 'timestamp',
        'Json': 'jsonb',
        'BigInt': 'bigint',
        'Decimal': 'decimal',
        'Bytes': 'bytes',
      }

      const mappedType = scalarTypes[cleanType]
      if (!mappedType) {
        // It's likely a relation field without @relation (other side)
        // Skip it as a column unless it has no model match
        continue
      }

      const isPK = rest.includes('@id')
      const isNullable = isOptionalRelation || fieldType.endsWith('?')
      const isForeignKey = rest.includes('@relation')
      // Prisma marks unique columns with @unique. PKs are inherently unique
      // and represented separately via isPrimaryKey.
      const isUnique = /@unique\b/.test(rest)

      // Extract default value
      let defaultValue: string | undefined
      const defaultMatch = rest.match(/@default\(([^)]+)\)/)
      if (defaultMatch) {
        defaultValue = defaultMatch[1]!
      }

      const column: ColumnInfo = {
        name: fieldName,
        type: mappedType,
        isNullable: isNullable || undefined,
        isPrimaryKey: isPK || undefined,
        isUnique: isUnique || undefined,
        defaultValue,
      }

      if (isPK) {
        primaryKey = fieldName
      }

      // Check if this field is a foreign key (e.g., authorId String, where there's a related @relation on another field)
      // We'll mark it if we find a relation referencing this column name
      currentColumns.push(column)
    }
  }

  // Mark FK columns based on relations
  for (const rel of relations) {
    const table = tables.find((t) => t.name === rel.sourceTable)
    if (table) {
      const col = table.columns.find((c) => c.name === rel.foreignKeyColumn)
      if (col) {
        col.isForeignKey = true
        col.referencesTable = rel.targetTable
        col.referencesColumn = rel.foreignKeyReferencesColumn
      }
    }
  }

  return { tables, relations }
}
