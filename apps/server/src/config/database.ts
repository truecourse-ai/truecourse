import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from '../db/schema.js';
import { ensureRepoTruecourseDir, getRepoDbDir } from './paths.js';
import type { RegistryEntry } from './registry.js';

type Database = ReturnType<typeof drizzle<typeof schema>>;

export interface ProjectDb {
  project: RegistryEntry;
  client: PGlite;
  db: Database;
  /**
   * True for in-memory handles seeded by `bindTestProjectDb`. Stale-cache
   * detection skips these since they're not backed by an on-disk directory
   * that could diverge from the cache.
   */
  ephemeral?: boolean;
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

/**
 * Auto-detect and configure the migrations folder based on where this
 * module is loaded from. Works in both dev (tsx) and dist (bundled). Used
 * by callers that don't go through the server's `main()` boot — e.g. the
 * CLI `analyze` command, which calls `analyzeInProcess` in-process.
 */
export function autoConfigureMigrations(): void {
  if (_migrationsFolder) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // `here` is either apps/server/src/config (tsx dev) or apps/server/dist/config
  // (built). In both cases `../db/migrations` points at the migrations dir —
  // tsx resolves to src/db/migrations, and the build script copies SQL to
  // dist/db/migrations so the built layout matches.
  const folder = path.join(here, '../db/migrations');
  if (!fs.existsSync(folder)) {
    throw new Error(
      `Migrations folder missing at ${folder}. Did the server build skip copying SQL?`,
    );
  }
  _migrationsFolder = folder;
}

function migrationsFolder(): string {
  if (!_migrationsFolder) {
    throw new Error('Migrations folder not configured. Call configureMigrations() at startup.');
  }
  return _migrationsFolder;
}

async function openProjectDb(project: RegistryEntry): Promise<ProjectDb> {
  if (!fs.existsSync(project.path)) {
    const err = new Error(`Project path no longer exists: ${project.path}`) as Error & { statusCode?: number };
    err.statusCode = 410;
    throw err;
  }
  const dataDir = getRepoDbDir(project.path);
  if (!fs.existsSync(dataDir)) {
    const err = new Error(`No analysis yet for "${project.name}". Run \`truecourse analyze\` first.`) as Error & {
      code?: string;
      statusCode?: number;
    };
    err.code = 'NO_PROJECT_DB';
    err.statusCode = 404;
    throw err;
  }
  const client = new PGlite(dataDir);
  await client.waitReady;
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: migrationsFolder() });
  return { project, client, db };
}

/**
 * Ensure the on-disk PGlite data directory exists so `openProjectDb` will
 * succeed. Called by `analyzeInProcess` (and the CLI analyze pre-open) for
 * a fresh project.
 *
 * If the cache has a handle but the on-disk cluster is missing (user deleted
 * `.truecourse/` out from under a running server), the cached handle is
 * stale and any PGlite operation against it will fail with "File exists"
 * races as its background WAL writes collide with a partial init. We close
 * the stale handle, wipe any partial state, and recreate.
 */
export async function initializeProjectDb(project: RegistryEntry): Promise<void> {
  const dbDir = getRepoDbDir(project.path);
  const pgVersionFile = path.join(dbDir, 'PG_VERSION');
  const cached = instances.get(project.path);

  if (cached) {
    const handle = await cached;
    // Ephemeral (test-bound) handles are in-memory and have no backing
    // directory — never invalidate them.
    if (!handle.ephemeral && !fs.existsSync(pgVersionFile)) {
      instances.delete(project.path);
      try {
        await handle.client.close();
      } catch {
        // best-effort
      }
      if (fs.existsSync(dbDir)) {
        fs.rmSync(dbDir, { recursive: true, force: true });
      }
    }
  }

  if (instances.has(project.path)) return;

  ensureRepoTruecourseDir(project.path);
  fs.mkdirSync(dbDir, { recursive: true });
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
  const ephemeralHandle: ProjectDb = { ...handle, ephemeral: true };
  instances.set(ephemeralHandle.project.path, Promise.resolve(ephemeralHandle));
  _testFallback = ephemeralHandle;
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
 * Close and evict a single project's PGlite handle. Called before removing
 * the on-disk data directory so file handles are released first.
 */
export async function closeProjectDb(projectPath: string): Promise<void> {
  const cached = instances.get(projectPath);
  if (!cached) return;
  instances.delete(projectPath);
  try {
    const handle = await cached;
    await handle.client.close();
  } catch {
    // best-effort — handle may already be closed
  }
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
