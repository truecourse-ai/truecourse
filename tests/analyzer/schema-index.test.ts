/**
 * Unit tests for `services/schema-index.ts`.
 *
 * Tests the index built from a synthetic DatabaseDetectionResult, plus the
 * Drizzle and Prisma parsers' .unique() / @unique detection.
 */
import { describe, it, expect } from 'vitest'
import { buildSchemaIndex, EMPTY_SCHEMA_INDEX } from '../../packages/analyzer/src/services/schema-index'
import { parseDrizzleSchema } from '../../packages/analyzer/src/schema-parsers/drizzle'
import { parsePrismaSchema } from '../../packages/analyzer/src/schema-parsers/prisma'
import type { DatabaseDetectionResult } from '@truecourse/shared'

function makeDbResult(tables: Array<{
  name: string
  columns: Array<{ name: string; isUnique?: boolean; isPrimaryKey?: boolean; type?: string }>
}>): DatabaseDetectionResult {
  return {
    databases: [
      {
        name: 'test_db',
        type: 'postgres',
        driver: 'postgres',
        tables: tables.map((t) => ({
          name: t.name,
          columns: t.columns.map((c) => ({
            name: c.name,
            type: c.type ?? 'text',
            isUnique: c.isUnique,
            isPrimaryKey: c.isPrimaryKey,
          })),
        })),
        relations: [],
        connectedServices: [],
      },
    ],
    connections: [],
  } as DatabaseDetectionResult
}

// ---------------------------------------------------------------------------
// SchemaIndex API
// ---------------------------------------------------------------------------

describe('SchemaIndex', () => {
  describe('hasSchemas', () => {
    it('returns false for empty index', () => {
      expect(EMPTY_SCHEMA_INDEX.hasSchemas()).toBe(false)
    })

    it('returns false when databaseResult is undefined', () => {
      expect(buildSchemaIndex(undefined).hasSchemas()).toBe(false)
    })

    it('returns true when at least one table is parsed', () => {
      const idx = buildSchemaIndex(makeDbResult([{ name: 'users', columns: [{ name: 'id', isPrimaryKey: true }] }]))
      expect(idx.hasSchemas()).toBe(true)
    })
  })

  describe('getColumn', () => {
    const idx = buildSchemaIndex(makeDbResult([
      {
        name: 'users',
        columns: [
          { name: 'id', isPrimaryKey: true },
          { name: 'email', isUnique: true },
          { name: 'name' },
        ],
      },
      {
        name: 'salesPeople',
        columns: [
          { name: 'id', isPrimaryKey: true },
          { name: 'userId' /* not unique — FK */ },
        ],
      },
    ]))

    it('returns the column when both table and column match', () => {
      const col = idx.getColumn('users', 'email')
      expect(col?.name).toBe('email')
      expect(col?.isUnique).toBe(true)
    })

    it('returns null for unknown table', () => {
      expect(idx.getColumn('orders', 'id')).toBeNull()
    })

    it('returns null for unknown column on a known table', () => {
      expect(idx.getColumn('users', 'nonexistent')).toBeNull()
    })
  })

  describe('isColumnUnique', () => {
    const idx = buildSchemaIndex(makeDbResult([
      {
        name: 'users',
        columns: [
          { name: 'id', isPrimaryKey: true },
          { name: 'email', isUnique: true },
          { name: 'name' },
        ],
      },
      {
        name: 'salesPeople',
        columns: [
          { name: 'id', isPrimaryKey: true },
          { name: 'userId' },
        ],
      },
    ]))

    it('returns true for primary keys', () => {
      expect(idx.isColumnUnique('users', 'id')).toBe(true)
    })

    it('returns true for explicitly unique columns', () => {
      expect(idx.isColumnUnique('users', 'email')).toBe(true)
    })

    it('returns false for non-unique columns', () => {
      expect(idx.isColumnUnique('users', 'name')).toBe(false)
    })

    it('returns false for FK columns that are not unique (the dealist case)', () => {
      expect(idx.isColumnUnique('salesPeople', 'userId')).toBe(false)
    })

    it('returns false for unknown columns', () => {
      expect(idx.isColumnUnique('users', 'nonexistent')).toBe(false)
    })
  })

  describe('findColumnByName', () => {
    const idx = buildSchemaIndex(makeDbResult([
      { name: 'users', columns: [{ name: 'email', isUnique: true }] },
      { name: 'audit_log', columns: [{ name: 'email' }] },
    ]))

    it('returns all columns matching the name', () => {
      const matches = idx.findColumnByName('email')
      expect(matches).toHaveLength(2)
      expect(matches.map((m) => m.table).sort()).toEqual(['audit_log', 'users'])
    })

    it('returns empty array when no columns match', () => {
      expect(idx.findColumnByName('nonexistent')).toEqual([])
    })

    it('preserves uniqueness info per match', () => {
      const matches = idx.findColumnByName('email')
      const usersEmail = matches.find((m) => m.table === 'users')
      const auditEmail = matches.find((m) => m.table === 'audit_log')
      expect(usersEmail?.column.isUnique).toBe(true)
      expect(auditEmail?.column.isUnique).toBeUndefined()
    })
  })
})

// ---------------------------------------------------------------------------
// Drizzle parser .unique() detection
// ---------------------------------------------------------------------------

describe('parseDrizzleSchema unique detection', () => {
  it('detects .unique() on a column', () => {
    const code = `
      import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
      export const users = pgTable('users', {
        id: uuid('id').primaryKey(),
        email: text('email').notNull().unique(),
      })
    `
    const { tables } = parseDrizzleSchema(code)
    const users = tables.find((t) => t.name === 'users')!
    const email = users.columns.find((c) => c.name === 'email')!
    expect(email.isUnique).toBe(true)
  })

  it('detects .unique("constraint_name") with explicit name', () => {
    const code = `
      import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
      export const users = pgTable('users', {
        id: uuid('id').primaryKey(),
        email: text('email').unique('users_email_unique'),
      })
    `
    const { tables } = parseDrizzleSchema(code)
    const email = tables[0]!.columns.find((c) => c.name === 'email')!
    expect(email.isUnique).toBe(true)
  })

  it('does NOT mark non-unique columns as unique', () => {
    const code = `
      import { pgTable, text, uuid } from 'drizzle-orm/pg-core'
      export const salesPeople = pgTable('sales_people', {
        id: uuid('id').primaryKey(),
        userId: uuid('user_id').notNull().references(() => users.id),
      })
    `
    const { tables } = parseDrizzleSchema(code)
    const userId = tables[0]!.columns.find((c) => c.name === 'userId')!
    expect(userId.isUnique).toBeUndefined()
  })

  it('marks primary keys correctly (separate from isUnique)', () => {
    const code = `
      import { pgTable, uuid } from 'drizzle-orm/pg-core'
      export const users = pgTable('users', {
        id: uuid('id').defaultRandom().primaryKey(),
      })
    `
    const { tables } = parseDrizzleSchema(code)
    const id = tables[0]!.columns.find((c) => c.name === 'id')!
    expect(id.isPrimaryKey).toBe(true)
    // Drizzle's .primaryKey() implies unique but doesn't call .unique() —
    // we represent that via isPrimaryKey, so isUnique stays unset.
  })
})

// ---------------------------------------------------------------------------
// Prisma parser @unique detection
// ---------------------------------------------------------------------------

describe('parsePrismaSchema unique detection', () => {
  it('detects @unique on a field', () => {
    const code = `
      model User {
        id    Int    @id @default(autoincrement())
        email String @unique
        name  String
      }
    `
    const { tables } = parsePrismaSchema(code)
    const email = tables[0]!.columns.find((c) => c.name === 'email')!
    expect(email.isUnique).toBe(true)
  })

  it('does NOT mark non-unique fields as unique', () => {
    const code = `
      model User {
        id   Int    @id
        name String
      }
    `
    const { tables } = parsePrismaSchema(code)
    const name = tables[0]!.columns.find((c) => c.name === 'name')!
    expect(name.isUnique).toBeUndefined()
  })

  it('marks primary keys correctly (separate from isUnique)', () => {
    const code = `
      model User {
        id Int @id
      }
    `
    const { tables } = parsePrismaSchema(code)
    const id = tables[0]!.columns.find((c) => c.name === 'id')!
    expect(id.isPrimaryKey).toBe(true)
  })
})
