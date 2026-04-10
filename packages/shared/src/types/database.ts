import { z } from 'zod'

// ---------------------------------------------------------------------------
// Database Type
// ---------------------------------------------------------------------------

export const DatabaseTypeSchema = z.enum([
  'postgres',
  'redis',
  'mongodb',
  'mysql',
  'sqlite',
])

export type DatabaseType = z.infer<typeof DatabaseTypeSchema>

// ---------------------------------------------------------------------------
// Column Info
// ---------------------------------------------------------------------------

export const ColumnInfoSchema = z.object({
  name: z.string(),
  type: z.string(),
  isNullable: z.boolean().optional(),
  isPrimaryKey: z.boolean().optional(),
  isUnique: z.boolean().optional(),
  defaultValue: z.string().optional(),
  isForeignKey: z.boolean().optional(),
  referencesTable: z.string().optional(),
  referencesColumn: z.string().optional(),
})

export type ColumnInfo = z.infer<typeof ColumnInfoSchema>

// ---------------------------------------------------------------------------
// Index Info
// ---------------------------------------------------------------------------

export const IndexInfoSchema = z.object({
  name: z.string().optional(),
  columns: z.array(z.string()),
  isUnique: z.boolean().optional(),
})

export type IndexInfo = z.infer<typeof IndexInfoSchema>

// ---------------------------------------------------------------------------
// Table Info
// ---------------------------------------------------------------------------

export const TableInfoSchema = z.object({
  name: z.string(),
  columns: z.array(ColumnInfoSchema),
  primaryKey: z.string().optional(),
  indexes: z.array(IndexInfoSchema).optional(),
  /**
   * Alternative names this table is known by. Used for ORMs where the
   * query-side name differs from the SQL name — e.g. Drizzle exports the
   * table as `salesPeople` (variable name) but the SQL name is `sales_people`.
   */
  aliases: z.array(z.string()).optional(),
})

export type TableInfo = z.infer<typeof TableInfoSchema>

// ---------------------------------------------------------------------------
// Relation Info
// ---------------------------------------------------------------------------

export const RelationInfoSchema = z.object({
  sourceTable: z.string(),
  targetTable: z.string(),
  relationType: z.enum(['one-to-one', 'one-to-many', 'many-to-many']),
  foreignKeyColumn: z.string(),
  foreignKeyReferencesColumn: z.string().optional(),
})

export type RelationInfo = z.infer<typeof RelationInfoSchema>

// ---------------------------------------------------------------------------
// Database Info (detected database instance)
// ---------------------------------------------------------------------------

export const DatabaseInfoSchema = z.object({
  name: z.string(),
  type: DatabaseTypeSchema,
  driver: z.string(),
  connectionEnvVar: z.string().optional(),
  tables: z.array(TableInfoSchema),
  relations: z.array(RelationInfoSchema),
  connectedServices: z.array(z.string()),
})

export type DatabaseInfo = z.infer<typeof DatabaseInfoSchema>

// ---------------------------------------------------------------------------
// Database Connection Info
// ---------------------------------------------------------------------------

export const DatabaseConnectionInfoSchema = z.object({
  serviceName: z.string(),
  databaseName: z.string(),
  driver: z.string(),
  layerName: z.string().optional(),
})

export type DatabaseConnectionInfo = z.infer<typeof DatabaseConnectionInfoSchema>

// ---------------------------------------------------------------------------
// Database Detection Result
// ---------------------------------------------------------------------------

export const DatabaseDetectionResultSchema = z.object({
  databases: z.array(DatabaseInfoSchema),
  connections: z.array(DatabaseConnectionInfoSchema),
})

export type DatabaseDetectionResult = z.infer<typeof DatabaseDetectionResultSchema>
