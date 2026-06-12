import type { TableInfo, ColumnInfo, RelationInfo } from '@truecourse/shared'

/**
 * Parse an Entity Framework Core file and extract tables and relations.
 *
 * Handles two file shapes:
 * - DbContext files: `public DbSet<Order> Orders { get; set; }` — yields the
 *   table names the context exposes (entity properties live in other files).
 * - Entity files: classes with `[Table("…")]` / `[Key]` annotations — yields
 *   tables with full column info ([Column] mappings, nullable `?` types,
 *   foreign keys by `<Nav>Id` convention).
 *
 * Convention-only entities (no annotations at all) are intentionally not
 * guessed at from bare POCOs — that would turn every DTO into a table.
 */
export function parseEfCoreSchema(content: string): {
  tables: TableInfo[]
  relations: RelationInfo[]
} {
  const tables: TableInfo[] = []
  const relations: RelationInfo[] = []

  // ---- DbContext shape: DbSet<Entity> PropertyName ----
  // EF's default table name IS the DbSet property name. When the entity class
  // is declared in the same file, its columns merge into this table below;
  // otherwise the name-only table still records the schema surface.
  const dbSets = [...content.matchAll(/DbSet<(\w+)>\s+(\w+)\s*(?:\{|=>|;)/g)]
  const dbSetByEntity = new Map<string, string>()
  for (const m of dbSets) {
    dbSetByEntity.set(m[1], m[2])
  }

  // ---- Entity shape: annotated classes ----
  // Split on top-level class/record declarations and inspect each body.
  const classRegex = /(?:\[[^\]]*\]\s*)*(?:public|internal)?\s*(?:sealed\s+|partial\s+)*(?:class|record)\s+(\w+)[^{]*\{/g
  let match: RegExpExecArray | null
  while ((match = classRegex.exec(content)) !== null) {
    const className = match[1]
    // Attributes immediately preceding the declaration
    const preceding = content.slice(Math.max(0, match.index - 300), match.index)
    const tableAttr = preceding.match(/\[Table\(\s*"([^"]+)"/)

    const body = extractBracedBlock(content, match.index + match[0].length - 1)
    if (body === null) continue

    const hasKey = /\[Key\]/.test(body)
    if (!tableAttr && !hasKey) continue // not provably an entity

    const columns: ColumnInfo[] = []
    let primaryKey: string | undefined

    // Property declarations with optional preceding attributes
    const propRegex = /((?:\[[^\]]*\]\s*)*)public\s+(?:virtual\s+)?([\w?<>.]+)\s+(\w+)\s*\{\s*get;/g
    let prop: RegExpExecArray | null
    const navProps: { name: string; type: string }[] = []
    while ((prop = propRegex.exec(body)) !== null) {
      const attrs = prop[1]
      const rawType = prop[2]
      const propName = prop[3]

      if (/\[NotMapped\]/.test(attrs)) continue

      // Collection / reference navigation properties → relations, not columns
      const collection = rawType.match(/^(?:ICollection|List|IEnumerable|HashSet)<(\w+)>$/)
      if (collection) {
        navProps.push({ name: propName, type: collection[1] })
        continue
      }
      if (/^[A-Z]/.test(rawType) && !KNOWN_VALUE_TYPES.has(rawType.replace(/\?$/, ''))) {
        // PascalCase non-BCL type — likely a reference navigation
        navProps.push({ name: propName, type: rawType.replace(/\?$/, '') })
        continue
      }

      const columnAttr = attrs.match(/\[Column\(\s*"([^"]+)"/)
      const columnName = columnAttr ? columnAttr[1] : snakeCase(propName)
      const isKey = /\[Key\]/.test(attrs) || propName === 'Id' || propName === `${className}Id`
      const foreignKey = propName.endsWith('Id') && propName !== 'Id' && propName !== `${className}Id`

      const column: ColumnInfo = {
        name: columnName,
        type: rawType.replace(/\?$/, ''),
        ...(rawType.endsWith('?') ? { isNullable: true } : {}),
        ...(isKey && !primaryKey ? { isPrimaryKey: true } : {}),
        ...(foreignKey ? { isForeignKey: true, referencesTable: snakeCase(propName.slice(0, -2)) } : {}),
      }
      if (isKey && !primaryKey) primaryKey = columnName
      columns.push(column)

      if (foreignKey) {
        relations.push({
          sourceTable: tableAttr ? tableAttr[1] : snakeCase(className),
          targetTable: snakeCase(propName.slice(0, -2)),
          relationType: 'one-to-many',
          foreignKeyColumn: columnName,
        })
      }
    }

    // Naming precedence: explicit [Table("…")] > same-file DbSet property
    // name (EF's convention default) > snake_cased class name.
    const tableName = tableAttr ? tableAttr[1] : dbSetByEntity.get(className) ?? snakeCase(className)
    tables.push({
      name: tableName,
      columns,
      ...(primaryKey ? { primaryKey } : {}),
      aliases: dedupe([className, snakeCase(className), snakeCase(tableName)]).filter((a) => a !== tableName),
    })

    // Collection navigations imply the reverse FK relation lives on the
    // other entity; FK-column relations are already recorded above, so
    // navProps only contribute when no matching Id column exists.
    void navProps
  }

  // Name-only tables for DbSets whose entity class lives in another file
  const emittedNames = new Set(tables.map((t) => t.name))
  const emittedAliases = new Set(tables.flatMap((t) => t.aliases ?? []))
  for (const [entityName, setName] of dbSetByEntity) {
    if (emittedNames.has(setName) || emittedAliases.has(entityName)) continue
    tables.push({
      name: setName,
      columns: [],
      aliases: dedupe([entityName, snakeCase(setName), snakeCase(entityName)]).filter((a) => a !== setName),
    })
  }

  return { tables, relations }
}

const KNOWN_VALUE_TYPES = new Set([
  'Guid', 'DateTime', 'DateTimeOffset', 'DateOnly', 'TimeOnly', 'TimeSpan',
  'String', 'Boolean', 'Byte', 'Int16', 'Int32', 'Int64', 'Decimal', 'Double', 'Single',
])

function snakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

/** The contents of a {…} block starting at the given `{` index. */
function extractBracedBlock(content: string, openBraceIndex: number): string | null {
  if (content[openBraceIndex] !== '{') return null
  let depth = 0
  for (let i = openBraceIndex; i < content.length; i++) {
    if (content[i] === '{') depth++
    else if (content[i] === '}') {
      depth--
      if (depth === 0) return content.slice(openBraceIndex + 1, i)
    }
  }
  return null
}
