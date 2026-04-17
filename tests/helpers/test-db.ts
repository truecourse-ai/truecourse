import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as schema from '../../apps/server/src/db/schema';
import {
  bindTestProjectDb,
  clearTestProjectDb,
  closeAllProjectDbs,
  type ProjectDb,
} from '../../apps/server/src/config/database';
import { registerProject, unregisterProject } from '../../apps/server/src/config/registry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, '../../apps/server/src/db/migrations');

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Create an in-memory PGlite instance, run the full migration set, and bind
 * it as the current request-scoped project so route handlers and services
 * that rely on the shared `db` proxy find it.
 *
 * The returned `db` is the same drizzle instance the server uses; test-side
 * setup/cleanup queries can run against it directly.
 */
export async function setupTestDb(fixturePath?: string): Promise<{ db: TestDb; client: PGlite }> {
  const client = new PGlite();
  await client.waitReady;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  // Register a test project in the global registry so `resolveProjectForRequest`
  // works for tests that drive route handlers via HTTP.
  const entry = registerProject(fixturePath ?? process.cwd());
  const handle: ProjectDb = { project: entry, client, db };
  bindTestProjectDb(handle);

  return { db, client };
}

export async function teardownTestDb(slug?: string): Promise<void> {
  clearTestProjectDb();
  if (slug) unregisterProject(slug);
  await closeAllProjectDbs();
}
