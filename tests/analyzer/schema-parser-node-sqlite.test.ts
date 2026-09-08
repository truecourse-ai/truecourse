import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { parseNodeSqliteSchema } from '../../packages/analyzer/src/schema-parsers/node-sqlite'

const wrap = (sql: string) => `import { DatabaseSync as SQLite } from 'node:sqlite';
function open() { const db = new SQLite(':memory:'); db.exec(${JSON.stringify(sql)}); }`

describe('static node:sqlite DDL', () => {
  it('reads the expense-store schema without importing or opening its database', () => {
    const source = fs.readFileSync(new URL('../fixtures/node-sqlite/lib/store.ts', import.meta.url), 'utf8')
    const { tables, relations } = parseNodeSqliteSchema(source)
    expect(tables.map(t => t.name)).toEqual(['expenses', 'metadata'])
    expect(tables[0].columns.map(c => c.name)).toEqual(['id', 'description', 'amount_cents', 'category', 'date', 'notes', 'created_at', 'updated_at'])
    expect(tables[0].columns[0]).toMatchObject({ name: 'id', type: 'INTEGER', isPrimaryKey: true, isNullable: false })
    expect(tables[0].columns.find(c => c.name === 'notes')).toMatchObject({ defaultValue: "''", isNullable: false })
    expect(tables[1].columns[0]).toMatchObject({ name: 'key', isPrimaryKey: true, isNullable: true })
    expect(relations).toEqual([])
  })

  it('handles quoted names, nested checks, defaults, comments and inline references', () => {
    const result = parseNodeSqliteSchema(wrap(`
      -- CREATE TABLE invented (x TEXT);
      CREATE TABLE "order, items" (
        "item id" INTEGER PRIMARY KEY,
        [description] TEXT DEFAULT 'a,b); ''quoted''',
        category TEXT CHECK(category IN ('PRIMARY KEY', 'NOT NULL', 'UNIQUE')),
        parent INTEGER REFERENCES parents(id),
        total DECIMAL(10,2) DEFAULT (round(1.25, 1)),
        created TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
        enabled INTEGER DEFAULT -1,
        /* A comma, and a closing ) don't end this definition. */
        CONSTRAINT one_description UNIQUE (description)
      );
    `))
    expect(result.tables).toHaveLength(1)
    const columns = result.tables[0].columns
    expect(columns.map(c => c.name)).toEqual(['item id', 'description', 'category', 'parent', 'total', 'created', 'enabled'])
    expect(columns[1]).toMatchObject({ isUnique: true, defaultValue: "'a,b); ''quoted'''" })
    expect(columns[2]).toMatchObject({ isNullable: true })
    expect(columns[2].isPrimaryKey).toBeUndefined()
    expect(columns[2].isUnique).toBeUndefined()
    expect(columns[4].defaultValue).toContain('round')
    expect(columns[5]).toMatchObject({ defaultValue: 'CURRENT_TIMESTAMP', isNullable: false })
    expect(columns[6].defaultValue).toBe('- 1')
    expect(result.relations[0]).toMatchObject({ sourceTable: 'order, items', targetTable: 'parents', foreignKeyColumn: 'parent', foreignKeyReferencesColumn: 'id' })
  })

  it('respects SQLite primary-key nullability and composite uniqueness', () => {
    const { tables } = parseNodeSqliteSchema(wrap(`
      CREATE TABLE composite (a TEXT, b TEXT, PRIMARY KEY(a,b), UNIQUE(a,b)) WITHOUT ROWID;
      CREATE TABLE strict_key (key TEXT PRIMARY KEY) STRICT;
      CREATE TABLE nullable_key (id INTEGER PRIMARY KEY DESC);
    `))
    expect(tables[0].primaryKey).toBeUndefined()
    expect(tables[0].columns.every(c => c.isPrimaryKey && c.isNullable === false)).toBe(true)
    expect(tables[0].columns.every(c => !c.isUnique)).toBe(true)
    expect(tables[1].columns[0].isNullable).toBe(false)
    expect(tables[2].columns[0].isNullable).toBe(true)
  })

  it('resolves a namespace import and an inline constructor receiver', () => {
    const source = `import * as sqlite from 'node:sqlite';
      new sqlite.DatabaseSync(':memory:').exec('CREATE TABLE real (id INTEGER)');`
    expect(parseNodeSqliteSchema(source).tables.map(t => t.name)).toEqual(['real'])
  })

  it('does not mistake shadowed names, other exec methods, unused text or interpolated SQL for a schema', () => {
    const source = `import { DatabaseSync } from 'node:sqlite';
      const db = new DatabaseSync(':memory:');
      const unused = 'CREATE TABLE unused (id INTEGER)';
      const help = { exec(text) {} }; help.exec('CREATE TABLE fake (id INTEGER)');
      function shadow(db) { db.exec('CREATE TABLE shadow (id INTEGER)'); }
      function shadowConstructor(DatabaseSync) { const local = new DatabaseSync(); local.exec('CREATE TABLE fake2 (id INTEGER)'); }
      db.exec(\`CREATE TABLE \${name} (id INTEGER)\`);
      db.exec(sqlFromElsewhere);
      db.exec('CREATE TABLE actual (id INTEGER)');`
    expect(parseNodeSqliteSchema(source).tables.map(t => t.name)).toEqual(['actual'])
  })

  it.each([
    'CREATE TABLE copy AS SELECT * FROM expenses;',
    'CREATE VIRTUAL TABLE search USING fts5(text);',
    "CREATE TABLE broken (text TEXT DEFAULT 'unclosed);",
    'CREATE TABLE broken (id INTEGER',
  ])('leaves unsupported or incomplete SQL unknown: %s', sql => {
    expect(parseNodeSqliteSchema(wrap(sql)).tables).toEqual([])
  })
})
