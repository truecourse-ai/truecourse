/**
 * The database handle every part of the service reads and writes the shelf through.
 *
 * Importing this module APPLIES THE MIGRATIONS: the files in `migrations/` are run,
 * in name order, before the module finishes loading. A cold datastore is therefore
 * migrated by whichever process touches it first — the HTTP service on boot, or any
 * script that imports this module — and a datastore that is already up to date is
 * left alone, because every migration is written to be idempotent.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { DATABASE_URL } from './config.js'
import * as schema from './schema.js'

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export const pool = new pg.Pool({ connectionString: DATABASE_URL })

/** Apply every `.sql` file in `migrations/`, in name order. */
export async function migrate() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const name of files) {
    await pool.query(fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf-8'))
  }
  return files
}

await migrate()

export const db = drizzle(pool, { schema })
