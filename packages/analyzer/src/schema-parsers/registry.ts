/**
 * Schema parser registry — each ORM registers how to detect and parse its schema files.
 *
 * To add a new ORM parser:
 * 1. Create a parser file (e.g., typeorm.ts)
 * 2. Register it here with import pattern, file validation, and DB type detection
 */

import type { FileAnalysis, DatabaseType, TableInfo, RelationInfo } from '@truecourse/shared'
import { parsePrismaSchema } from './prisma.js'
import { parseDrizzleSchema } from './drizzle.js'
import { parseSqlAlchemySchema } from './sqlalchemy.js'
import { parseEfCoreSchema } from './efcore.js'

interface SchemaParserBase {
  /** Name for logging */
  name: string
  /** Check if a file's imports indicate this ORM */
  matchesImport(analysis: FileAnalysis): boolean
  /** Quick content check before full parsing (optional optimization) */
  validateContent?(content: string): boolean
  /** Parse the file content and return tables + relations */
  parse(content: string): { tables: TableInfo[]; relations: RelationInfo[] }
}

interface FileSchemaParser extends SchemaParserBase {
  scope: 'file'
  /** Determine the database type from the file content */
  detectDbType(content: string): DatabaseType
}

interface ServiceSchemaParser extends SchemaParserBase {
  scope: 'service'
}

type SchemaParserEntry = FileSchemaParser | ServiceSchemaParser

export const EF_CORE_SCHEMA_PARSER: ServiceSchemaParser = {
  name: 'EFCore',
  scope: 'service',
  // Entity POCOs often import only DataAnnotations, not EF itself
  matchesImport: (fa) =>
    fa.language === 'csharp' &&
    fa.imports.some(
      (imp) =>
        imp.source.startsWith('Microsoft.EntityFrameworkCore') ||
        imp.source.startsWith('System.ComponentModel.DataAnnotations'),
    ),
  validateContent: (content) =>
    /DbSet</.test(content) || /\[Table\(/.test(content) || /\[Key\]/.test(content),
  parse: parseEfCoreSchema,
}

export const SCHEMA_PARSERS: SchemaParserEntry[] = [
  {
    name: 'Drizzle',
    scope: 'file',
    matchesImport: (fa) => fa.imports.some((imp) => imp.source.startsWith('drizzle-orm')),
    validateContent: (content) => /(?:pgTable|mysqlTable|sqliteTable)\s*\(/.test(content),
    parse: parseDrizzleSchema,
    detectDbType: (content) => {
      if (content.includes('mysqlTable')) return 'mysql'
      if (content.includes('sqliteTable')) return 'sqlite'
      return 'postgres'
    },
  },
  {
    name: 'SQLAlchemy',
    scope: 'file',
    matchesImport: (fa) => fa.imports.some(
      (imp) => imp.source === 'sqlalchemy' || imp.source.startsWith('sqlalchemy.')
    ),
    validateContent: (content) => content.includes('__tablename__'),
    parse: parseSqlAlchemySchema,
    detectDbType: () => 'postgres', // SQLAlchemy default; could parse engine URL for others
  },
  EF_CORE_SCHEMA_PARSER,
  // Prisma is handled separately (file-based, not import-based) — see database-detector.ts
]
