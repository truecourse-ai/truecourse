import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const TEST_PORT = 5435;
const TEST_DB = 'truecourse_test';
const TEST_DATA_DIR = path.join(os.homedir(), '.truecourse', 'test-data');
const MIGRATIONS_DIR = path.join(
  new URL('../apps/server/src/db/migrations', import.meta.url).pathname
);

let pg: EmbeddedPostgres | null = null;

/**
 * Vitest global setup — starts embedded PostgreSQL and runs migrations.
 * Runs once before all test files.
 */
export async function setup() {
  fs.mkdirSync(TEST_DATA_DIR, { recursive: true });

  const isFirstRun = !fs.existsSync(path.join(TEST_DATA_DIR, 'PG_VERSION'));

  pg = new EmbeddedPostgres({
    databaseDir: TEST_DATA_DIR,
    port: TEST_PORT,
    user: 'postgres',
    password: 'postgres',
    persistent: true,
    onLog: () => {},
    onError: () => {},
  });

  if (isFirstRun) {
    await pg.initialise();
  }

  await pg.start();

  // Create test database
  try {
    await pg.createDatabase(TEST_DB);
  } catch {
    // Already exists
  }

  // Run migrations
  const testDbUrl = `postgresql://postgres:postgres@localhost:${TEST_PORT}/${TEST_DB}`;
  const migrationClient = postgres(testDbUrl, { max: 1 });
  await migrate(drizzle(migrationClient), {
    migrationsFolder: MIGRATIONS_DIR,
  });
  await migrationClient.end();

  // Set env var for tests to use
  process.env.DATABASE_URL = testDbUrl;
}

export async function teardown() {
  if (pg) {
    try {
      await pg.stop();
    } catch {
      // Ignore stop errors
    }
  }
}
