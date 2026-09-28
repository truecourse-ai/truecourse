/**
 * The schema the parsers read: Prisma enums (declared, and as a column's type),
 * and the files each datastore's schema was read from.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parsePrismaSchema } from '../../packages/source-facts/src/schema-parsers/prisma'
import { parseDrizzleSchema } from '../../packages/source-facts/src/schema-parsers/drizzle'
import { detectDatabases } from '../../packages/source-facts/src/database-detector'

const SCHEMA = `datasource db {
  provider = "postgresql"
}

enum Role {
  ADMIN
  USER @map("user") // the default
  @@map("roles")
}

model User {
  id     Int     @id
  role   Role    @default(USER)
  plan   Plan?
  email  String  @unique
  links  Link[]
}

enum Plan {
  FREE
  PRO
}

model Link {
  id     Int    @id
  owner  User   @relation(fields: [ownerId], references: [id])
  ownerId Int
}
`

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('parsePrismaSchema — enums', () => {
  it('declares each enum with its values, attributes and comments aside', () => {
    expect(parsePrismaSchema(SCHEMA).enums).toEqual([
      { name: 'Role', values: ['ADMIN', 'USER'] },
      { name: 'Plan', values: ['FREE', 'PRO'] },
    ])
  })

  it('keeps an enum-typed field as a column typed by the enum, nullable when optional', () => {
    const user = parsePrismaSchema(SCHEMA).tables.find((table) => table.name === 'User')!
    expect(user.columns.find((column) => column.name === 'role')).toMatchObject({ type: 'Role', defaultValue: 'USER' })
    expect(user.columns.find((column) => column.name === 'plan')).toMatchObject({ type: 'Plan', isNullable: true })
    // A relation list is still not a column.
    expect(user.columns.map((column) => column.name)).not.toContain('links')
  })
})

describe('parseDrizzleSchema — a namespace import', () => {
  const NAMESPACED = `import * as pg from "drizzle-orm/pg-core";
import { account } from "./account";

export const note = pg.pgTable(
	"note",
	{
		id: pg
			.text("id")
			.notNull()
			.primaryKey()
			.$defaultFn(() => generateId()),
		title: pg.text("title").notNull(),
		isPinned: pg.boolean("is_pinned").notNull().default(false),
		accountId: pg
			.text("account_id")
			.notNull()
			.references(() => account.id, { onDelete: "cascade" }),
		createdAt: pg.timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [pg.index().on(t.accountId)],
);

export const tag = pg.pgTable("tag", {
	name: pg.text("name").primaryKey(),
});

// Another module's builder, not drizzle's: never a table.
export const other = elsewhere.pgTable("other", { id: elsewhere.text("id") });
`

  it('reads tables and columns built through the namespace', () => {
    const { tables, relations } = parseDrizzleSchema(NAMESPACED)
    expect(tables.map((table) => table.name)).toEqual(['note', 'tag'])
    const note = tables[0]!
    expect(note.primaryKey).toBe('id')
    expect(note.columns.map((column) => [column.name, column.type])).toEqual([
      ['id', 'text'],
      ['title', 'text'],
      ['isPinned', 'boolean'],
      ['accountId', 'text'],
      ['createdAt', 'timestamp'],
    ])
    expect(relations).toEqual([
      expect.objectContaining({ sourceTable: 'note', targetTable: 'account', foreignKeyColumn: 'accountId' }),
    ])
  })
})

describe('detectDatabases — the schema files', () => {
  it("names the files each datastore's schema was read from, repo-relative, with the enums", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-schema-files-'))
    dirs.push(root)
    fs.mkdirSync(path.join(root, 'packages/prisma'), { recursive: true })
    fs.writeFileSync(path.join(root, 'packages/prisma/schema.prisma'), SCHEMA)
    const { databases } = detectDatabases(root, [], [])
    // No import names prisma, so the parsed schema belongs to no detected datastore.
    expect(databases).toEqual([])

    const analysis = {
      filePath: path.join(root, 'src/db.ts'),
      language: 'typescript',
      imports: [{ source: '@prisma/client', specifiers: [], isTypeOnly: false }],
    } as unknown as Parameters<typeof detectDatabases>[1][number]
    const service = { name: 'app', rootPath: root, files: [analysis.filePath] } as unknown as Parameters<typeof detectDatabases>[2][number]
    const [postgres] = detectDatabases(root, [analysis], [service]).databases
    expect(postgres.schemaFiles).toEqual(['packages/prisma/schema.prisma'])
    expect(postgres.enums?.map((declared) => declared.name)).toEqual(['Role', 'Plan'])
    expect(postgres.tables.map((table) => table.name)).toEqual(['User', 'Link'])
  })
})
