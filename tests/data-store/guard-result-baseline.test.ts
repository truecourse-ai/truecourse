/**
 * The commit a repository's guard views anchor on: what the default branch's
 * CURRENT state was produced at. The newest scenario set's commit names it,
 * a report alone names it when no set was stored (a blocked corpus), a
 * version under another scope never does, and the purge takes it with
 * everything else.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { GuardGenerateReport } from '@truecourse/shared';
import { PgGuardStore, purgeRepoData } from '../../packages/data-store/src/index';

const REPO = 'acme/api';

let client: PGlite;
let db: Db;
let store: PgGuardStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as Db;
  store = new PgGuardStore(db);
});
afterEach(async () => {
  await client.close();
});

const report = (generatedAt: string): GuardGenerateReport => ({
  generatedAt,
  status: 'ok',
  sectionsTotal: 1,
  sectionsChanged: 1,
  skippedUnchanged: 0,
  noChanges: false,
  written: [],
  coverageGaps: [],
  birthFindings: [],
  errors: [],
  extractionFailures: [],
  orphaned: [],
});

/** A one-file scenario set saved at `commit`. */
async function saveSet(commit: string, scope?: string): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-set-'));
  try {
    fs.writeFileSync(path.join(dir, 'recipe.json'), '{}');
    await store.saveScenarios({ repoKey: REPO, commitSha: commit, ...(scope ? { scope } : {}) }, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

describe('PgGuardStore guard baseline', () => {
  it('answers null until something is stored in the scope', async () => {
    expect(await store.readGuardBaselineCommit(REPO)).toBeNull();
    // A pull request's own line of versions never anchors the default branch.
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'prhead1', scope: 'pr/1' }, report('2026-01-02T00:00:00Z'));
    await saveSet('prhead1', 'pr/1');
    expect(await store.readGuardBaselineCommit(REPO)).toBeNull();
    expect(await store.readGuardBaselineCommit(REPO, 'pr/1')).toBe('prhead1');
  });

  it('anchors on the newest scenario set, by when it was stored', async () => {
    await saveSet('main1');
    await tick();
    await saveSet('main2');
    await tick();
    // A report written later at another commit does not move the anchor: the
    // set is what the views read, and its commit is the one they are labelled by.
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'main3' }, report('2026-01-09T00:00:00Z'));
    expect(await store.readGuardBaselineCommit(REPO)).toBe('main2');
    expect(await store.readGuardBaselineCommit('other/repo')).toBeNull();
  });

  it('a rollback moves the anchor to the restored version’s commit', async () => {
    await saveSet('main1');
    await tick();
    await saveSet('main2');
    const [, older] = await store.listGuardVersions(REPO, 'scenarios');
    await tick();
    await store.restoreGuardScenarioSet(REPO, older!.id);
    expect(await store.readGuardBaselineCommit(REPO)).toBe('main1');
  });

  it('falls back to the newest report when no set was ever stored', async () => {
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'main1' }, report('2026-01-01T00:00:00Z'));
    await tick();
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'main2' }, report('2026-01-03T00:00:00Z'));
    expect(await store.readGuardBaselineCommit(REPO)).toBe('main2');
  });

  it('is purged with the repo', async () => {
    await saveSet('main1');
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'main1' }, report('2026-01-01T00:00:00Z'));
    await purgeRepoData(db, REPO);
    expect(await store.readGuardBaselineCommit(REPO)).toBeNull();
  });
});
