import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
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

// Isolate the test process from the developer's real `~/.truecourse/` state.
// `TRUECOURSE_HOME` is read lazily by `config/paths.ts`, so setting it here
// (before any registry access) reroutes registry.json + config.json + logs
// into a per-run temp dir.
if (!process.env.TRUECOURSE_HOME) {
  process.env.TRUECOURSE_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-test-home-'));
  process.on('exit', () => {
    try {
      fs.rmSync(process.env.TRUECOURSE_HOME!, { recursive: true, force: true });
    } catch {
      // best-effort
    }
  });
}

const cleanupPaths: { tmpDir: string | null; truecourseDir: string | null }[] = [];

/**
 * Create an in-memory PGlite instance, run the full migration set, and bind
 * it as the current request-scoped project so route handlers and services
 * that rely on the shared `db` proxy find it.
 *
 * When no `fixturePath` is given we use a throwaway temp dir — tests must
 * never touch the developer's repo root or leak `.truecourse/` into source.
 * For tests that DO pass a real fixture path (because they need to read
 * files from it), any `.truecourse/` we create during setup is removed on
 * teardown so fixtures stay clean.
 */
export async function setupTestDb(fixturePath?: string): Promise<{ db: TestDb; client: PGlite }> {
  const client = new PGlite();
  await client.waitReady;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  let projectPath = fixturePath;
  let tmpDir: string | null = null;
  if (!projectPath) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-test-proj-'));
    projectPath = tmpDir;
  }

  const truecourseDir = path.join(projectPath, '.truecourse');
  const preexisting = fs.existsSync(truecourseDir);

  const entry = registerProject(projectPath);
  const handle: ProjectDb = { project: entry, client, db };
  bindTestProjectDb(handle);

  cleanupPaths.push({
    tmpDir,
    truecourseDir: preexisting ? null : truecourseDir,
  });

  return { db, client };
}

export async function teardownTestDb(slug?: string): Promise<void> {
  clearTestProjectDb();
  if (slug) unregisterProject(slug);
  await closeAllProjectDbs();
  while (cleanupPaths.length > 0) {
    const { tmpDir, truecourseDir } = cleanupPaths.pop()!;
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    } else if (truecourseDir) {
      try {
        fs.rmSync(truecourseDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
}
