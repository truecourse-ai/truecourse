/**
 * Drive the drizzle migrations by hand, one at a time, for a test that seeds
 * rows BEFORE a migration and reads what it did to them. The migrator applies
 * every file in journal order; a backfill can only be tested by stopping short
 * of it.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { MIGRATIONS_DIR } from '@truecourse/db';

interface Journal {
  entries: Array<{ tag: string }>;
}

/** Apply every migration up to (not including) `stopAt`, in journal order. */
export async function applyMigrationsBefore(client: PGlite, stopAt: string): Promise<void> {
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf-8')) as Journal;
  for (const entry of journal.entries) {
    if (entry.tag === stopAt) return;
    await applyMigration(client, entry.tag);
  }
  throw new Error(`migration ${stopAt} is not in the journal`);
}

/** Apply one migration file, statement by statement. */
export async function applyMigration(client: PGlite, tag: string): Promise<void> {
  const sqlText = fs.readFileSync(path.join(MIGRATIONS_DIR, `${tag}.sql`), 'utf-8');
  for (const statement of sqlText.split('--> statement-breakpoint')) {
    if (statement.trim()) await client.exec(statement);
  }
}
