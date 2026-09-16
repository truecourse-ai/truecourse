/**
 * The server's one Postgres connection, opened at boot.
 *
 * `initDb` applies the migrations and parks the handle; everything else reads
 * it through `getDb()`. A single module-level handle means one pool and one
 * migration ledger for the whole process.
 */

import { createDb, type Db, type DbHandle } from '@truecourse/db';
import { log } from '@truecourse/core/lib/logger';

let handle: DbHandle | null = null;

export async function initDb(databaseUrl: string): Promise<DbHandle> {
  if (handle) return handle;
  handle = await createDb(databaseUrl, {
    // An idle connection the backend dropped is one connection lost, not a crash:
    // the pool has already discarded it and reconnects on the next checkout.
    onPoolError: (err, pool) =>
      log.warn(`[db] idle Postgres client error on the ${pool} pool, connection dropped: ${err.message}`),
  });
  return handle;
}

function requireHandle(): DbHandle {
  if (!handle) throw new Error('[db] not initialised — call initDb() at boot before reading the db.');
  return handle;
}

export function getDb(): Db {
  return requireHandle().db;
}

/** The full handle (pool + the dedicated advisory-lock pool). */
export function getDbHandle(): DbHandle {
  return requireHandle();
}

export async function closeDb(): Promise<void> {
  if (!handle) return;
  const open = handle;
  handle = null;
  await open.close();
}
