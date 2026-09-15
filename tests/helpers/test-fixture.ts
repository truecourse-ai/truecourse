import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  setRegistryStore as setRegistryStoreByPackage,
  slugify,
  type RegistryEntry,
  type RegistryStore,
} from '@truecourse/core/config/registry';
import { setRegistryStore as setRegistryStoreBySource } from '../../packages/core/src/config/registry';

/**
 * The route-test fixture: a repository the routes can resolve, plus a throwaway
 * working directory to put files in.
 *
 * Production resolves a `:id` slug through the registry the Postgres store
 * reads off the connected repositories. A route test has no database, so it
 * installs an IN-MEMORY registry of exactly the repositories it created — the
 * same seam, the same slugs. Every fixture belongs to the one test workspace,
 * so the workspace a read is scoped to is not consulted here.
 */

const entries: RegistryEntry[] = [];

const memoryRegistry: RegistryStore = {
  async readRegistry() {
    return [...entries];
  },
  async getProjectBySlug(_workspaceOrgId, slug) {
    return entries.find((e) => e.slug === slug) ?? null;
  },
  async getProjectByPath(_workspaceOrgId, repoPath) {
    return entries.find((e) => e.path === repoPath) ?? null;
  },
};

/**
 * Install the in-memory registry with nothing in it — what a suite needs when
 * it reads the registry without registering a repository.
 *
 * Installed through both specifiers: the package resolves to the built `dist`
 * under vitest and the source path to `src`, and they are separate module
 * instances with separate state.
 */
export function installTestRegistry(): void {
  setRegistryStoreByPackage(memoryRegistry);
  setRegistryStoreBySource(memoryRegistry);
}

const cleanupPaths: { tmpDir: string | null; workTree: string | null }[] = [];

export interface TestFixture {
  project: RegistryEntry;
  repoPath: string;
}

/**
 * Register a repository and return its entry. Without `fixturePath` a throwaway
 * temp directory is used; tests put whatever the feature under test reads into
 * it.
 */
export async function setupTestFixture(fixturePath?: string): Promise<TestFixture> {
  installTestRegistry();
  let repoPath = fixturePath;
  let tmpDir: string | null = null;
  if (!repoPath) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-test-proj-'));
    repoPath = tmpDir;
  }
  const resolved = path.resolve(repoPath);
  const workTree = path.join(resolved, '.truecourse');
  const preexisting = fs.existsSync(workTree);

  const existing = entries.find((e) => e.path === resolved);
  const project =
    existing ??
    {
      slug: slugify(path.basename(resolved), entries.map((e) => e.slug)),
      name: path.basename(resolved),
      path: resolved,
    };
  if (!existing) entries.push(project);
  cleanupPaths.push({ tmpDir, workTree: preexisting ? null : workTree });

  return { project, repoPath: resolved };
}

export async function teardownTestFixture(slug?: string): Promise<void> {
  if (slug) unregisterTestRepo(slug);
  while (cleanupPaths.length > 0) {
    const { tmpDir, workTree } = cleanupPaths.pop()!;
    if (tmpDir) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    } else if (workTree) {
      try {
        fs.rmSync(workTree, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  }
}

/** Drop ONE repository from the in-memory registry (an unlink, in the test's world). */
export function unregisterTestRepo(slug: string): void {
  const at = entries.findIndex((e) => e.slug === slug);
  if (at !== -1) entries.splice(at, 1);
}

/** Forget every registered repository — what a suite's `afterEach` clears. */
export function clearTestRegistry(): void {
  entries.length = 0;
}
