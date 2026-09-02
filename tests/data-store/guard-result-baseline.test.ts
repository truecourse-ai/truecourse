/**
 * The guard BASELINE flag on a stored generate report: what the hosted
 * repo-level views anchor on when the repo has no analyze baseline. Only a
 * flagged row counts, the newest by generation time wins, a re-write can drop
 * the flag, and the purge takes it with everything else.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

describe('PgGuardStore guard baseline', () => {
  it('answers null until a report is written as a baseline', async () => {
    expect(await store.readGuardBaselineCommit(REPO)).toBeNull();
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'prhead1' }, report('2026-01-02T00:00:00Z'));
    // An unflagged row (a PR head's regenerate) is never the anchor.
    expect(await store.readGuardBaselineCommit(REPO)).toBeNull();
  });

  it('anchors on the newest flagged row by generation time, whatever else was written', async () => {
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'main1' }, report('2026-01-01T00:00:00Z'), {
      baseline: true,
    });
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'main2' }, report('2026-01-03T00:00:00Z'), {
      baseline: true,
    });
    // A later-written but earlier-generated baseline (a re-run over an old
    // commit) does not outrank the newer default-branch one.
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'main0' }, report('2025-12-31T00:00:00Z'), {
      baseline: true,
    });
    // Nor does a newer PR-head row.
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'prhead9' }, report('2026-01-09T00:00:00Z'));

    expect(await store.readGuardBaselineCommit(REPO)).toBe('main2');
    expect(await store.readGuardBaselineCommit('other/repo')).toBeNull();
  });

  it('a re-write of the same commit carries the flag it was given', async () => {
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'main1' }, report('2026-01-01T00:00:00Z'), {
      baseline: true,
    });
    expect(await store.readGuardBaselineCommit(REPO)).toBe('main1');
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'main1' }, report('2026-01-01T00:00:00Z'));
    expect(await store.readGuardBaselineCommit(REPO)).toBeNull();
  });

  it('is purged with the repo', async () => {
    await store.writeGuardResult({ repoKey: REPO, commitSha: 'main1' }, report('2026-01-01T00:00:00Z'), {
      baseline: true,
    });
    await purgeRepoData(db, REPO);
    expect(await store.readGuardBaselineCommit(REPO)).toBeNull();
  });
});
