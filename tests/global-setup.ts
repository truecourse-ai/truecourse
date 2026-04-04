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

// Capture listeners before embedded-postgres registers its AsyncExitHook.
// These hooks prevent vitest from exiting cleanly and cause it to always
// exit 0 regardless of test results.
const HOOK_EVENTS = ['exit', 'beforeExit', 'SIGINT', 'SIGTERM', 'SIGHUP'];
const listenersBefore = new Map<string, Function[]>();
for (const event of HOOK_EVENTS) {
  listenersBefore.set(event, [...(process as NodeJS.EventEmitter).listeners(event)]);
}

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

  // Create test database (throws if it already exists)
  try {
    await pg.createDatabase(TEST_DB);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!msg.includes('already exists')) throw error;
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
    await pg.stop();
    pg = null;
  }

  // Remove AsyncExitHook listeners that embedded-postgres registered at
  // import time so vitest can exit with the correct code.
  const emitter = process as NodeJS.EventEmitter;
  for (const [event, before] of listenersBefore) {
    for (const listener of emitter.listeners(event)) {
      if (!before.includes(listener)) {
        emitter.removeListener(event, listener as (...args: unknown[]) => void);
      }
    }
  }
}
