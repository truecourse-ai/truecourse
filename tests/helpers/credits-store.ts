/**
 * The CREDITS store for a suite: the real Postgres one over PGlite, since what
 * it answers is SQL — the row lock that keeps concurrent debits exact, the
 * statement's fold per run — and an in-memory stand-in would prove none of it.
 *
 * The seam is set through BOTH specifiers a test can reach core by — the package
 * (`@truecourse/core/lib/credits-store`, which resolves to the built `dist`) and
 * the source path — because under vitest those are separate module instances
 * with separate seam state. The USAGE store rides along: a debit names the
 * `llm_usage` row it charges, so the two are one schema and one PGlite.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import {
  setCreditsStore as setByPackage,
  resetCreditsStore as resetByPackage,
} from '@truecourse/core/lib/credits-store';
import {
  setCreditsStore as setBySource,
  resetCreditsStore as resetBySource,
} from '../../packages/core/src/lib/credits-store';
import {
  setUsageStore as setUsageByPackage,
  resetUsageStore as resetUsageByPackage,
} from '@truecourse/core/lib/usage-store';
import {
  setUsageStore as setUsageBySource,
  resetUsageStore as resetUsageBySource,
} from '../../packages/core/src/lib/usage-store';
import { PgCreditsStore, PgUsageStore } from '../../packages/data-store/src/index';

export interface InstalledCreditsStore {
  db: Db;
  store: PgCreditsStore;
  usage: PgUsageStore;
  close(): Promise<void>;
}

export async function installCreditsStore(): Promise<InstalledCreditsStore> {
  const client = new PGlite();
  const db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const store = new PgCreditsStore(db);
  const usage = new PgUsageStore(db);
  setByPackage(store);
  setBySource(store);
  setUsageByPackage(usage);
  setUsageBySource(usage);
  return {
    db,
    store,
    usage,
    async close() {
      resetCreditsStore();
      await client.close();
    },
  };
}

export function resetCreditsStore(): void {
  resetByPackage();
  resetBySource();
  resetUsageByPackage();
  resetUsageBySource();
}
