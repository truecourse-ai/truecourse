/**
 * The USAGE store for a suite: the real Postgres one over PGlite, since what it
 * answers is SQL — the sums, the buckets, the grouping — and an in-memory
 * stand-in would prove none of it.
 *
 * The seam is set through BOTH specifiers a test can reach core by — the package
 * (`@truecourse/core/lib/usage-store`, which resolves to the built `dist`) and
 * the source path — because under vitest those are separate module instances
 * with separate seam state.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import {
  setUsageStore as setByPackage,
  resetUsageStore as resetByPackage,
} from '@truecourse/core/lib/usage-store';
import {
  setUsageStore as setBySource,
  resetUsageStore as resetBySource,
} from '../../packages/core/src/lib/usage-store';
import { PgUsageStore } from '../../packages/data-store/src/index';

export interface InstalledUsageStore {
  db: Db;
  store: PgUsageStore;
  close(): Promise<void>;
}

export async function installUsageStore(): Promise<InstalledUsageStore> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const store = new PgUsageStore(db);
  setByPackage(store);
  setBySource(store);
  return {
    db,
    store,
    async close() {
      resetUsageStore();
      await client.close();
    },
  };
}

export function resetUsageStore(): void {
  resetByPackage();
  resetBySource();
}
