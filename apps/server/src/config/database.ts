import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from '../db/schema.js';

type Database = ReturnType<typeof drizzle<typeof schema>>;

let _db: Database | undefined;
let _client: PGlite | undefined;

/**
 * Initialize the database connection against a local data directory.
 * Must be called before the server starts handling requests.
 */
export async function initDatabase(dataDir: string): Promise<void> {
  _client = new PGlite(dataDir);
  await _client.waitReady;
  _db = drizzle(_client, { schema });
}

/**
 * Inject a pre-built PGlite client and Drizzle instance. Used by tests so
 * they can share a single in-memory instance between the server code and
 * test-side setup/cleanup queries.
 */
export function setDatabase(drizzleDb: Database, client: PGlite): void {
  _client = client;
  _db = drizzleDb;
}

/**
 * Close the database connection.
 */
export async function closeDatabase(): Promise<void> {
  if (_client) {
    await _client.close();
    _client = undefined;
    _db = undefined;
  }
}

/** Underlying PGlite client — used by the Drizzle migrator. */
export function getClient(): PGlite {
  if (!_client) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return _client;
}

/**
 * Get the Drizzle database instance.
 * Throws if initDatabase() has not been called.
 */
export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    if (!_db) {
      throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return Reflect.get(_db, prop, receiver);
  },
});
