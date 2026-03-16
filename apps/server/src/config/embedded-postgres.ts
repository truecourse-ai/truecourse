import EmbeddedPostgres from 'embedded-postgres';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const DEFAULT_PORT = 5434;
const DATABASE_NAME = 'truecourse';

let instance: EmbeddedPostgres | null = null;

function getDataDir(): string {
  return path.join(os.homedir(), '.truecourse', 'data');
}

function getPort(): number {
  return parseInt(process.env.EMBEDDED_PG_PORT || '', 10) || DEFAULT_PORT;
}

/**
 * Start the embedded PostgreSQL instance.
 * Downloads the Postgres binary on first run.
 * Returns the connection URL for the truecourse database.
 *
 * If DATABASE_URL is already set, this is a no-op and returns the existing URL.
 */
export async function startEmbeddedPostgres(): Promise<string> {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const dataDir = getDataDir();
  const port = getPort();

  fs.mkdirSync(dataDir, { recursive: true });

  const isFirstRun = !fs.existsSync(path.join(dataDir, 'PG_VERSION'));

  instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    port,
    user: 'postgres',
    password: 'postgres',
    persistent: true,
    onLog: () => {},
    onError: () => {},
  });

  if (isFirstRun) {
    console.log('[Database] Initializing embedded PostgreSQL (first run, downloading binary)...');
    await instance.initialise();
  }

  try {
    await instance.start();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || '');
    if (message.includes('address already in use') || message.includes('EADDRINUSE') || !message) {
      throw new Error(
        `Port ${port} is already in use. Is another TrueCourse instance or PostgreSQL running?\n` +
        `Stop the other instance first.`
      );
    }
    throw new Error(`Failed to start embedded PostgreSQL: ${message}`);
  }

  // Create the application database if it doesn't exist
  try {
    await instance.createDatabase(DATABASE_NAME);
  } catch {
    // Database already exists — this is fine
  }

  const url = `postgresql://postgres:postgres@localhost:${port}/${DATABASE_NAME}`;
  return url;
}

/**
 * Stop the embedded PostgreSQL instance.
 */
export async function stopEmbeddedPostgres(): Promise<void> {
  if (instance) {
    try {
      await instance.stop();
    } catch {
      // Ignore stop errors during shutdown
    }
    instance = null;
  }
}
