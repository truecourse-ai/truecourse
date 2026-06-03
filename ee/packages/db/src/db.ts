/**
 * The single ee Postgres connection + Drizzle db, with the one consolidated
 * migration history applied on startup. ee-server creates ONE of these and
 * hands the shared `db` to every feature store (gate, LLM config, and — later —
 * analysis/drift), so there's exactly one pool and one migration ledger.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { schema } from './schema/index.js';

/** Generated migrations live at the package root (`drizzle/`), one level up from src|dist. */
export const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../drizzle',
);

export type EeDb = NodePgDatabase<typeof schema>;

export type { Pool, PoolClient } from 'pg';

export interface EeDbHandle {
  db: EeDb;
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

export async function createEeDb(connectionString: string): Promise<EeDbHandle> {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  // Dedicated lock pool (see EeDbHandle.lockPool). A generous `max` — concurrent
  // analyses are bounded by merge cadence — and a connect timeout so pathological
  // contention fails fast instead of hanging. Advisory locks are session-scoped,
  // so Postgres auto-releases them if a held connection ever drops.
  const lockPool = new Pool({ connectionString, max: 20, connectionTimeoutMillis: 30_000 });
  return {
    db,
    lockPool,
    close: async () => {
      await Promise.all([pool.end(), lockPool.end()]);
    },
  };
}
