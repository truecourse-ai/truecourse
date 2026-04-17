import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/**
 * Apply Drizzle-generated SQL migrations against a PGlite instance.
 *
 * Uses `pg.exec()` (simple-query protocol) so multi-statement scripts work
 * without the prepared-statement single-command restriction. Tracks applied
 * migrations in `drizzle.__drizzle_migrations` for compatibility with the
 * stock drizzle-orm migrator.
 */
export async function migratePGlite(pg: PGlite, migrationsFolder: string): Promise<void> {
  const journalPath = path.join(migrationsFolder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    throw new Error(`No migration journal at ${journalPath}`);
  }
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as Journal;

  await pg.exec(`
    CREATE SCHEMA IF NOT EXISTS drizzle;
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at BIGINT
    );
  `);

  const applied = await pg.query<{ hash: string }>('SELECT hash FROM drizzle.__drizzle_migrations');
  const appliedHashes = new Set(applied.rows.map((r) => r.hash));

  for (const entry of journal.entries) {
    const sqlPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    const sql = fs.readFileSync(sqlPath, 'utf-8');
    const hash = crypto.createHash('sha256').update(sql).digest('hex');
    if (appliedHashes.has(hash)) continue;

    // Strip Drizzle statement-breakpoint comments; exec() handles the rest.
    const cleaned = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
      .join('\n');

    try {
      await pg.exec(cleaned);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Migration ${entry.tag} failed: ${message}`);
    }

    await pg.query(
      'INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
      [hash, entry.when],
    );
  }
}
