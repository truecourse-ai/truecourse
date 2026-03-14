import { describe, it, expect } from 'vitest';
import { parseDrizzleSchema } from '../../packages/analyzer/src/schema-parsers/drizzle';

describe('parseDrizzleSchema', () => {
  it('extracts pgTable definitions', () => {
    const source = `
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
});
`;
    const result = parseDrizzleSchema(source);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]!.name).toBe('users');
  });

  it('extracts mysqlTable definitions', () => {
    const source = `
import { mysqlTable, varchar, int } from 'drizzle-orm/mysql-core';

export const users = mysqlTable('users', {
  id: int('id').primaryKey(),
  name: varchar('name').notNull(),
});
`;
    const result = parseDrizzleSchema(source);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]!.name).toBe('users');
  });

  it('extracts sqliteTable definitions', () => {
    const source = `
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
});
`;
    const result = parseDrizzleSchema(source);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]!.name).toBe('users');
  });

  it('maps column types correctly', () => {
    const source = `
export const items = pgTable('items', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  count: integer('count').notNull(),
  active: boolean('active').notNull(),
  createdAt: timestamp('created_at').notNull(),
  data: jsonb('data'),
  label: varchar('label'),
  seq: serial('seq'),
  big: bigint('big'),
  score: real('score'),
  price: numeric('price'),
});
`;
    const result = parseDrizzleSchema(source);
    const table = result.tables[0]!;

    const colTypes = Object.fromEntries(table.columns.map((c) => [c.name, c.type]));
    expect(colTypes['id']).toBe('uuid');
    expect(colTypes['name']).toBe('text');
    expect(colTypes['count']).toBe('integer');
    expect(colTypes['active']).toBe('boolean');
    expect(colTypes['createdAt']).toBe('timestamp');
    expect(colTypes['data']).toBe('jsonb');
    expect(colTypes['label']).toBe('varchar');
    expect(colTypes['seq']).toBe('serial');
    expect(colTypes['big']).toBe('bigint');
    expect(colTypes['score']).toBe('real');
    expect(colTypes['price']).toBe('numeric');
  });

  it('detects .primaryKey() columns', () => {
    const source = `
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
});
`;
    const result = parseDrizzleSchema(source);
    const table = result.tables[0]!;

    expect(table.primaryKey).toBe('id');
    const idCol = table.columns.find((c) => c.name === 'id')!;
    expect(idCol.isPrimaryKey).toBe(true);
  });

  it('detects .notNull() columns as non-nullable', () => {
    const source = `
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  bio: text('bio'),
});
`;
    const result = parseDrizzleSchema(source);
    const table = result.tables[0]!;

    const nameCol = table.columns.find((c) => c.name === 'name')!;
    // notNull means NOT nullable
    expect(nameCol.isNullable).toBeFalsy();

    const bioCol = table.columns.find((c) => c.name === 'bio')!;
    // No .notNull() means nullable
    expect(bioCol.isNullable).toBe(true);
  });

  it('detects .references() and creates foreign key info', () => {
    const source = `
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
});

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  authorId: uuid('author_id').notNull().references(() => users.id),
});
`;
    const result = parseDrizzleSchema(source);

    // Check foreign key on column
    const postsTable = result.tables.find((t) => t.name === 'posts')!;
    const authorIdCol = postsTable.columns.find((c) => c.name === 'authorId')!;
    expect(authorIdCol.isForeignKey).toBe(true);
    expect(authorIdCol.referencesTable).toBe('users');
    expect(authorIdCol.referencesColumn).toBe('id');

    // Check relations
    expect(result.relations).toHaveLength(1);
    const rel = result.relations[0]!;
    expect(rel.sourceTable).toBe('posts');
    expect(rel.targetTable).toBe('users');
    expect(rel.foreignKeyColumn).toBe('authorId');
    expect(rel.foreignKeyReferencesColumn).toBe('id');
    expect(rel.relationType).toBe('one-to-many');
  });

  it('handles .references() with options like onDelete', () => {
    const source = `
export const posts = pgTable('posts', {
  id: uuid('id').primaryKey(),
  authorId: uuid('author_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
});
`;
    const result = parseDrizzleSchema(source);
    const table = result.tables[0]!;
    const authorIdCol = table.columns.find((c) => c.name === 'authorId')!;
    expect(authorIdCol.isForeignKey).toBe(true);
    expect(authorIdCol.referencesTable).toBe('users');
    expect(authorIdCol.referencesColumn).toBe('id');
  });

  it('detects default values', () => {
    const source = `
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});
`;
    const result = parseDrizzleSchema(source);
    const table = result.tables[0]!;

    const idCol = table.columns.find((c) => c.name === 'id')!;
    expect(idCol.defaultValue).toBeDefined();
    expect(idCol.defaultValue).toContain('defaultRandom');

    const createdAtCol = table.columns.find((c) => c.name === 'createdAt')!;
    expect(createdAtCol.defaultValue).toBeDefined();
    expect(createdAtCol.defaultValue).toContain('defaultNow');
  });

  it('extracts multiple tables from a single file', () => {
    const source = `
export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
});

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
});

export const comments = pgTable('comments', {
  id: uuid('id').primaryKey(),
  body: text('body').notNull(),
});
`;
    const result = parseDrizzleSchema(source);
    expect(result.tables).toHaveLength(3);
    expect(result.tables.map((t) => t.name)).toEqual(['users', 'posts', 'comments']);
  });

  it('handles empty source code', () => {
    const result = parseDrizzleSchema('');
    expect(result.tables).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });

  it('handles source code with no table definitions', () => {
    const source = `
import { drizzle } from 'drizzle-orm';
const db = drizzle(pool);
`;
    const result = parseDrizzleSchema(source);
    expect(result.tables).toHaveLength(0);
    expect(result.relations).toHaveLength(0);
  });

  it('handles tables without export keyword', () => {
    const source = `
const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
});
`;
    const result = parseDrizzleSchema(source);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0]!.name).toBe('users');
  });

  it('handles multiple foreign keys in one table', () => {
    const source = `
export const comments = pgTable('comments', {
  id: uuid('id').primaryKey(),
  postId: uuid('post_id').notNull().references(() => posts.id),
  authorId: uuid('author_id').notNull().references(() => users.id),
});
`;
    const result = parseDrizzleSchema(source);
    expect(result.relations).toHaveLength(2);

    const postRel = result.relations.find((r) => r.foreignKeyColumn === 'postId')!;
    expect(postRel.targetTable).toBe('posts');

    const authorRel = result.relations.find((r) => r.foreignKeyColumn === 'authorId')!;
    expect(authorRel.targetTable).toBe('users');
  });
});
