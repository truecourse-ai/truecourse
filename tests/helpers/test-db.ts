import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as schema from '../../apps/server/src/db/schema';
import { setDatabase, closeDatabase } from '../../apps/server/src/config/database';
import { migratePGlite } from '../../apps/server/src/config/migrate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../apps/server/src/db/migrations');

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Create an in-memory PGlite instance, run the full migration set, and
 * register it as the server's shared `db` proxy. Returns the drizzle
 * handle + raw PGlite client so callers can run setup/cleanup directly.
 */
export async function setupTestDb(): Promise<{ db: TestDb; client: PGlite }> {
  const client = new PGlite();
  await client.waitReady;
  await migratePGlite(client, MIGRATIONS_FOLDER);
  const db = drizzle(client, { schema });
  setDatabase(db, client);
  return { db, client };
}

export async function teardownTestDb(): Promise<void> {
  await closeDatabase();
}
