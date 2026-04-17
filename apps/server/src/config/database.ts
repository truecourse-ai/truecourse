import { AsyncLocalStorage } from 'node:async_hooks';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../db/schema.js';
import { getRepoDbDir } from './paths.js';
import type { RegistryEntry } from './registry.js';

type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface ProjectDb {
  project: RegistryEntry;
  client: PGlite;
  db: Database;
}

// ---------------------------------------------------------------------------
// Per-repo instance cache + request-scoped ALS
// ---------------------------------------------------------------------------

const instances = new Map<string, Promise<ProjectDb>>();
const als = new AsyncLocalStorage<ProjectDb>();
// Test-only fallback (used when ALS is not populated, e.g. services invoked
// directly from a test without going through the projectResolver middleware).
let _testFallback: ProjectDb | null = null;

let _migrationsFolder: string | null = null;

/**
 * Configure where Drizzle migration SQL files live. Called once at server
 * startup; resolved then because the dev vs dist layout differs.
 */
export function configureMigrations(folder: string): void {
  _migrationsFolder = folder;
}

function migrationsFolder(): string {
  if (!_migrationsFolder) {
    throw new Error('Migrations folder not configured. Call configureMigrations() at startup.');
  }
  return _migrationsFolder;
}

async function openProjectDb(project: RegistryEntry): Promise<ProjectDb> {
  const dataDir = getRepoDbDir(project.path);
  const client = new PGlite(dataDir);
  await client.waitReady;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  // Seed the rule catalogue into this repo's DB. Lazy import to avoid a
  // bootstrapping cycle (rules.service imports `db` from this module).
  const { seedRules } = await import('../services/rules.service.js');
  await seedRules(db);
  return { project, client, db };
}

/**
 * Resolve the `ProjectDb` for a registered project, opening and caching a
 * PGlite instance on first access.
 */
export function getOrOpenProjectDb(project: RegistryEntry): Promise<ProjectDb> {
  const key = project.path;
  let existing = instances.get(key);
  if (!existing) {
    existing = openProjectDb(project).catch((err) => {
      // Invalidate the cached promise if the open failed so later retries
      // don't keep surfacing the same error.
      instances.delete(key);
      throw err;
    });
    instances.set(key, existing);
  }
  return existing;
}

/**
 * Run `fn` with `project` bound as the active request-scoped DB. Route
 * middleware wraps the rest of the request chain with this so handlers and
 * services can use the shared `db` proxy without threading the instance
 * through every function signature.
 */
export async function withProjectDb<T>(
  project: RegistryEntry,
  fn: () => Promise<T>,
): Promise<T> {
  const handle = await getOrOpenProjectDb(project);
  return als.run(handle, fn);
}

/**
 * Bind a `ProjectDb` as the test-time fallback for the shared `db` proxy AND
 * seed the per-repo instance cache so the projectResolver middleware reuses
 * the same handle when a test drives HTTP routes.
 *
 * Only used by tests. Production code goes through `withProjectDb`.
 */
export function bindTestProjectDb(handle: ProjectDb): void {
  instances.set(handle.project.path, Promise.resolve(handle));
  _testFallback = handle;
}

export function clearTestProjectDb(): void {
  _testFallback = null;
}

export function getCurrentProjectDb(): ProjectDb | null {
  return als.getStore() ?? _testFallback ?? null;
}

export function requireCurrentProjectDb(): ProjectDb {
  const handle = als.getStore() ?? _testFallback;
  if (!handle) {
    throw new Error('No active project DB. Ensure the request passes through projectResolver middleware.');
  }
  return handle;
}

/**
 * Evict an open PGlite instance (close the client) and drop it from the
 * cache. Used on graceful shutdown.
 */
export async function closeAllProjectDbs(): Promise<void> {
  const handles = await Promise.all(instances.values());
  instances.clear();
  for (const handle of handles) {
    try {
      await handle.client.close();
    } catch {
      // Best-effort on shutdown.
    }
  }
}

// ---------------------------------------------------------------------------
// Shared Drizzle proxy — resolves to the ALS-bound project DB.
// ---------------------------------------------------------------------------

export const db = new Proxy({} as Database, {
  get(_target, prop, receiver) {
    const handle = als.getStore() ?? _testFallback;
    if (!handle) {
      throw new Error(
        'No active project DB in context. Wrap the call in `withProjectDb(project, fn)` or rely on the projectResolver middleware.',
      );
    }
    return Reflect.get(handle.db, prop, receiver);
  },
});
