/**
 * The single ee Postgres connection + Drizzle db, with the one consolidated
 * migration history applied on startup. ee-server creates ONE of these and
 * hands the shared `db` to every feature store (gate, LLM config, and — later —
 * analysis/drift), so there's exactly one pool and one migration ledger.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { schema } from './schema/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Generated migrations live at the package root (`drizzle/`), one level up
 * from src|dist — except in the published bundle, where this module is inlined
 * into `server.mjs` at the package root itself and the build copies the
 * migrations to a sibling `drizzle/` dir. Probe both so the same code boots
 * from a source checkout and from an npm install.
 */
export const MIGRATIONS_DIR =
  [path.resolve(HERE, '../drizzle'), path.resolve(HERE, 'drizzle')].find((p) =>
    fs.existsSync(path.join(p, 'meta', '_journal.json')),
  ) ?? path.resolve(HERE, '../drizzle');

export type Db = NodePgDatabase<typeof schema>;

export type { Pool, PoolClient } from 'pg';

export interface DbHandle {
  db: Db;
  /**
   * A SEPARATE pool, dedicated to the `pg_advisory_lock` analyze lock. The lock
   * holds a connection open for the entire (minutes-long) analyze; the store
   * (`db`) issues many short queries DURING that analyze on its own pool. If
   * both shared one pool, enough concurrent locks would pin every connection and
   * the store queries running inside those same analyses could never get one —
   * a deadlock. Isolating the lock pool removes that coupling.
   */
  lockPool: Pool;
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /**
   * Called when an IDLE pooled connection errors (the backend closed it, a
   * network drop, a protocol fault). The pool has already discarded that client
   * and reconnects on demand; the caller only gets to log it. Defaults to stderr.
   */
  onPoolError?: (err: Error, pool: 'main' | 'lock') => void;
}

/**
 * pg emits an idle client's error on the POOL, and an `error` event with no
 * listener is an uncaught exception: without this, one dropped connection
 * takes the whole process down.
 */
function watchIdleErrors(pool: Pool, name: 'main' | 'lock', onError: CreateDbOptions['onPoolError']): void {
  pool.on('error', (err) => {
    if (onError) onError(err, name);
    else console.error(`[db] idle Postgres client error on the ${name} pool: ${err.message}`);
  });
}

export async function createDb(connectionString: string, options: CreateDbOptions = {}): Promise<DbHandle> {
  const pool = new Pool({ connectionString });
  watchIdleErrors(pool, 'main', options.onPoolError);
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  // Dedicated lock pool (see DbHandle.lockPool). A generous `max` — concurrent
  // analyses are bounded by merge cadence — and a connect timeout so pathological
  // contention fails fast instead of hanging. Advisory locks are session-scoped,
  // so Postgres auto-releases them if a held connection ever drops.
  const lockPool = new Pool({ connectionString, max: 20, connectionTimeoutMillis: 30_000 });
  watchIdleErrors(lockPool, 'lock', options.onPoolError);
  return {
    db,
    lockPool,
    close: async () => {
      await Promise.all([pool.end(), lockPool.end()]);
    },
  };
}
