/**
 * The server's one Postgres connection, opened at boot.
 *
 * `initDb` applies the migrations and parks the handle; everything else reads
 * it through `getDb()`. A single module-level handle means one pool and one
 * migration ledger for the whole process.
 */

import { createDb, type Db, type DbHandle } from '@truecourse/db';

let handle: DbHandle | null = null;

export async function initDb(databaseUrl: string): Promise<DbHandle> {
  if (handle) return handle;
  handle = await createDb(databaseUrl);
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
