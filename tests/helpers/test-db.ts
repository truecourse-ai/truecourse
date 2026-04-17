import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  registerProject,
  unregisterProject,
  type RegistryEntry,
} from '../../apps/server/src/config/registry';
import { clearLatestCache } from '../../apps/server/src/lib/analysis-store';

/**
 * File-store test harness. Each call creates a throwaway repo dir and
 * registers it in the per-run registry. Tests seed the store by writing
 * `LATEST.json` (via `writeLatest` from `analysis-store`) or by running
 * the analyze pipeline end-to-end.
 *
 * No database — file-store only. Legacy name (`test-db.ts`) retained so
 * existing `import { setupTestDb } from '../helpers/test-db'` sites keep
 * working; both `setupTestDb` and the newer `setupTestFixture` are exported.
 */

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

export interface TestFixture {
  project: RegistryEntry;
  repoPath: string;
}

/**
 * Create (or adopt) a repo dir, register it, and return the project entry.
 * When `fixturePath` is omitted a throwaway temp dir is used. Tests call
 * `writeLatest(project.path, ...)` or run the analyze pipeline to seed
 * violations / graph data.
 */
export async function setupTestFixture(fixturePath?: string): Promise<TestFixture> {
  let repoPath = fixturePath;
  let tmpDir: string | null = null;
  if (!repoPath) {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-test-proj-'));
    repoPath = tmpDir;
  }

  const truecourseDir = path.join(repoPath, '.truecourse');
  const preexisting = fs.existsSync(truecourseDir);

  const project = registerProject(repoPath);
  cleanupPaths.push({
    tmpDir,
    truecourseDir: preexisting ? null : truecourseDir,
  });

  clearLatestCache();
  return { project, repoPath };
}

export async function teardownTestFixture(slug?: string): Promise<void> {
  clearLatestCache();
  if (slug) unregisterProject(slug);
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

// ---------------------------------------------------------------------------
// Back-compat aliases
// ---------------------------------------------------------------------------

/** @deprecated Use setupTestFixture — kept so existing imports still resolve. */
export const setupTestDb = setupTestFixture;

/** @deprecated Use teardownTestFixture. */
export const teardownTestDb = teardownTestFixture;

export type TestDb = never;
