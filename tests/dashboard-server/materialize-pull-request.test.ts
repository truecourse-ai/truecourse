/**
 * What a pull request check starts from: the base's scenario set and report
 * at the EXACT merge-base commit, materialized into the clone, and nothing
 * when that commit holds no set — a report alone is no base.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgGuardStore } from '@truecourse/data-store';
import { manifestPath, scenariosDir, readGuardResult as readTreeResult } from '@truecourse/guard-runner';
import { GUARD_FORMAT_VERSION, type GuardGenerateReport } from '@truecourse/shared';
import { resetGuardStore, saveScenarios, setGuardStore, writeGuardResult } from '@truecourse/core/lib/guard-store';
import { materializeStoredGuardState } from '../../apps/dashboard/server/src/jobs/materialize-guard';

const REPO = 'acme/widgets';
let client: PGlite;
let db: Db;
let tree: string;

const report = (generatedAt: string): GuardGenerateReport => ({
  generatedAt,
  status: 'ok',
  noChanges: false,
  written: [],
  birthFindings: [],
  sectionsTotal: 0,
  sectionsChanged: 0,
  skippedUnchanged: 0,
  coverageGaps: [],
  errors: [],
  extractionFailures: [],
  orphaned: [],
});

/** A scenario set with one flow, saved at `commit`. */
async function storeSet(commit: string, flowId: string): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pr-set-'));
  fs.mkdirSync(scenariosDir(dir), { recursive: true });
  fs.writeFileSync(
    manifestPath(dir),
    JSON.stringify({ version: GUARD_FORMAT_VERSION, flows: [{ flowId, flowFingerprint: 'fp', bindings: [], scenarios: [], interfaces: [], generationInputsHash: null }] }) + '\n',
  );
  await saveScenarios({ repoKey: REPO, commitSha: commit }, scenariosDir(dir));
  await writeGuardResult({ repoKey: REPO, commitSha: commit }, report(`2026-01-0${commit.slice(-1)}T00:00:00Z`));
}

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  setGuardStore(new PgGuardStore(db));
  tree = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-pr-tree-'));
});

afterEach(async () => {
  resetGuardStore();
  await client.close();
  fs.rmSync(tree, { recursive: true, force: true });
});

describe('materializeStoredGuardState at a commit', () => {
  it('writes the set stored at that commit, not the newest', async () => {
    await storeSet('commit-1', 'old-flow');
    await storeSet('commit-2', 'new-flow');
    expect(await materializeStoredGuardState(REPO, tree, { commitSha: 'commit-1' })).toBe('commit-1');
    const manifest = JSON.parse(fs.readFileSync(manifestPath(tree), 'utf-8')) as { flows: { flowId: string }[] };
    expect(manifest.flows.map((f) => f.flowId)).toEqual(['old-flow']);
    expect(readTreeResult(tree)?.generatedAt).toBe('2026-01-01T00:00:00Z');
  });

  it('answers null and writes nothing for a commit with a report but no set', async () => {
    await storeSet('commit-1', 'old-flow');
    await writeGuardResult({ repoKey: REPO, commitSha: 'commit-9' }, report('2026-01-09T00:00:00Z'));
    expect(await materializeStoredGuardState(REPO, tree, { commitSha: 'commit-9' })).toBeNull();
    expect(fs.existsSync(manifestPath(tree))).toBe(false);
    expect(readTreeResult(tree)).toBeNull();
  });

  it('still takes the newest set when no commit is named', async () => {
    await storeSet('commit-1', 'old-flow');
    await storeSet('commit-2', 'new-flow');
    expect(await materializeStoredGuardState(REPO, tree)).toBe('commit-2');
    const manifest = JSON.parse(fs.readFileSync(manifestPath(tree), 'utf-8')) as { flows: { flowId: string }[] };
    expect(manifest.flows.map((f) => f.flowId)).toEqual(['new-flow']);
  });
});
