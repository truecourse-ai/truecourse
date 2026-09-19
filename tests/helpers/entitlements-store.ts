/**
 * The ENTITLEMENTS store for a suite: the real Postgres one over PGlite, since
 * what it answers is SQL — the per-(workspace, feature) row, and the listing
 * that gathers every workspace this deployment knows about at all.
 *
 * The seam is set through BOTH specifiers a test can reach core by — the package
 * (`@truecourse/core/lib/entitlements-store`, which resolves to the built
 * `dist`) and the source path — because under vitest those are separate module
 * instances with separate seam state.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import {
  setEntitlementsStore as setByPackage,
  resetEntitlementsStore as resetByPackage,
} from '@truecourse/core/lib/entitlements-store';
import {
  setEntitlementsStore as setBySource,
  resetEntitlementsStore as resetBySource,
} from '../../packages/core/src/lib/entitlements-store';
import { PgEntitlementsStore } from '../../packages/data-store/src/index';

export interface InstalledEntitlementsStore {
  db: Db;
  store: PgEntitlementsStore;
  close(): Promise<void>;
}

export async function installEntitlementsStore(): Promise<InstalledEntitlementsStore> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const store = new PgEntitlementsStore(db);
  setByPackage(store);
  setBySource(store);
  return {
    db,
    store,
    async close() {
      resetEntitlementsStore();
      await client.close();
    },
  };
}

export function resetEntitlementsStore(): void {
  resetByPackage();
  resetBySource();
}
