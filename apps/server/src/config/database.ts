import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '../db/schema.js';

type Database = ReturnType<typeof drizzle<typeof schema>>;

let _db: Database | undefined;
let _client: ReturnType<typeof postgres> | undefined;

/**
 * Initialize the database connection with the given URL.
 * Must be called before the server starts handling requests.
 */
export function initDatabase(databaseUrl: string): void {
  _client = postgres(databaseUrl);
  _db = drizzle(_client, { schema });
}

/**
 * Close the database connection.
 */
export async function closeDatabase(): Promise<void> {
  if (_client) {
    await _client.end();
    _client = undefined;
    _db = undefined;
  }
}

/**
 * Get the database instance.
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
