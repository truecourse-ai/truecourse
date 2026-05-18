import { basename } from 'node:path'
import type { CodeFact, RelationInfo, TableInfo } from '@truecourse/shared'
import { parseDrizzleSchema } from '../schema-parsers/drizzle.js'
import { parsePrismaSchema } from '../schema-parsers/prisma.js'
import { parseSqlAlchemySchema } from '../schema-parsers/sqlalchemy.js'
import { EXTRACTORS } from './metadata.js'
import { pushFact } from './utils.js'

function parserFor(sourceFile: string, content: string): (() => { tables: TableInfo[]; relations: RelationInfo[] }) | null {
  if (basename(sourceFile) === 'schema.prisma') return () => parsePrismaSchema(content)
  if (/\b(?:from|require\s*\()\s*['"]drizzle-orm(?:\/|['"])/.test(content) && /\b(?:pgTable|mysqlTable|sqliteTable)\s*\(/.test(content)) {
    return () => parseDrizzleSchema(content)
  }
  if (sourceFile.endsWith('.py') && /\b(?:from\s+sqlalchemy\b|import\s+sqlalchemy\b)/.test(content) && content.includes('__tablename__')) {
    return () => parseSqlAlchemySchema(content)
  }
  return null
}

export function extractSchemaFacts(sourceFile: string, content: string, facts: CodeFact[]): void {
  const parse = parserFor(sourceFile, content)
  if (!parse) return

  const { tables, relations } = parse()
  for (const table of tables) {
    pushFact(facts, sourceFile, undefined, 'data.table', 'table.exists', {
      name: table.name,
      aliases: table.aliases ?? [],
      primaryKey: table.primaryKey,
    }, EXTRACTORS.schema)

    for (const column of table.columns) {
      pushFact(facts, sourceFile, undefined, 'data.field', 'field.exists', {
        table: table.name,
        name: column.name,
        type: column.type,
        required: column.isNullable === false || column.isPrimaryKey === true,
        primaryKey: column.isPrimaryKey === true,
        unique: column.isUnique === true,
        foreignKey: column.isForeignKey === true,
        referencesTable: column.referencesTable,
        referencesColumn: column.referencesColumn,
      }, EXTRACTORS.schema)

      if (column.isUnique || column.isPrimaryKey) {
        pushFact(facts, sourceFile, undefined, 'data.index', 'index.exists', {
          table: table.name,
          columns: [column.name],
          unique: true,
          primaryKey: column.isPrimaryKey === true,
        }, EXTRACTORS.schema)
      }
    }

    for (const index of table.indexes ?? []) {
      pushFact(facts, sourceFile, undefined, 'data.index', 'index.exists', {
        table: table.name,
        name: index.name,
        columns: index.columns,
        unique: index.isUnique === true,
      }, EXTRACTORS.schema)
    }
  }

  for (const relation of relations) {
    pushFact(facts, sourceFile, undefined, 'data.relation', 'relation.exists', relation, EXTRACTORS.schema)
  }
}
