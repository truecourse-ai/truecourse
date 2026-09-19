/**
 * `0028_integration_connections` owns the connections table. The init migration
 * created it, but a database that ran the migration-era draft of `0021` dropped
 * it, and Drizzle records a migration by its timestamp rather than its text, so
 * the table has to be created again where it is missing and left alone where it
 * is not. Either way the dead `pending` column goes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { sql } from 'drizzle-orm';
import { schema, MIGRATIONS_DIR } from '@truecourse/db';

const MIGRATION = path.join(MIGRATIONS_DIR, '0029_integration_connections.sql');

let client: PGlite;

beforeEach(() => {
  client = new PGlite();
});

afterEach(async () => {
  await client.close();
});

async function columnsOf(table: string): Promise<string[]> {
  const rows = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_name = $1 order by ordinal_position`,
    [table],
  );
  return rows.rows.map((r) => r.column_name);
}

/** The migration's statements, split the way the migrator splits them. */
function statements(): string[] {
  return fs
    .readFileSync(MIGRATION, 'utf-8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

describe('0029_integration_connections', () => {
  it('leaves a healthy database with the table and without the pending column', async () => {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    expect(await columnsOf('integration_connections')).toEqual([
      'workspace_org_id',
      'provider',
      'config',
      'token_enc',
      'created_at',
      'updated_at',
    ]);
    const index = await db.execute(
      sql`select indexname from pg_indexes where tablename = 'integration_connections' and indexname = 'integration_connections_org_idx'`,
    );
    expect(index.rows).toHaveLength(1);
  });

  it('brings the table back on a database that dropped it', async () => {
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    await client.exec('DROP TABLE "integration_connections" CASCADE');
    expect(await columnsOf('integration_connections')).toEqual([]);

    for (const statement of statements()) await client.exec(statement);

    expect(await columnsOf('integration_connections')).toEqual([
      'workspace_org_id',
      'provider',
      'config',
      'token_enc',
      'created_at',
      'updated_at',
    ]);
    // And again: the migration is idempotent, so a re-run changes nothing.
    for (const statement of statements()) await client.exec(statement);
    expect(await columnsOf('integration_connections')).toHaveLength(6);
  });
});
