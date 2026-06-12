import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgVerifyStore, PgSpecStore } from '../../ee/packages/data-store/src/index';
import type { VerifyLatest } from '@truecourse/core/types/verify-snapshot';

const REPO = 'workspace-1/my-repo';

let client: PGlite;
let db: EeDb;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as EeDb;
});
afterEach(async () => {
  await client.close();
});

type Drift = { severity: string };

/** A minimal VerifyLatest at `commit`, verified at `verifiedAt`, with N drifts. */
const latest = (commit: string, verifiedAt: string, drifts: Drift[] = []): VerifyLatest =>
  ({
    head: commit,
    run: {
      id: `run-${commit}`,
      verifiedAt,
      branch: 'main',
      commitHash: commit,
      contractsDir: 'reference',
      codeDir: 'src',
    },
    artifactCount: 3,
    extractedOperationCount: 5,
    drifts,
    resolverErrors: [],
    unresolvedRefs: [],
    summary: { total: drifts.length, bySeverity: {} },
  }) as unknown as VerifyLatest;

describe('PgVerifyStore (verify_snapshots)', () => {
  it('writeVerifyLatest marks the baseline; readVerifyLatest returns it', async () => {
    const store = new PgVerifyStore(db);
    expect(await store.readVerifyLatest(REPO)).toBeNull();

    await store.writeVerifyLatest(REPO, latest('c1', '2026-01-01T00:00:00.000Z', [{ severity: 'high' }]));
    const got = await store.readVerifyLatest(REPO);
    expect(got?.run.commitHash).toBe('c1');
    expect(got?.drifts).toHaveLength(1);
  });

  it('a PR-head snapshot (spec store verifyState) does NOT move the baseline', async () => {
    const verify = new PgVerifyStore(db);
    const spec = new PgSpecStore(db);
    // baseline = main1 (0 drifts)
    await verify.writeVerifyLatest(REPO, latest('main1', '2026-01-01T00:00:00.000Z', []));
    // a PR head verify (transient → spec store's verifyState route), 2 drifts
    await spec.saveSpec(
      { repoKey: REPO, commitSha: 'prhead' },
      'verifyState',
      { verifiedAt: '2026-01-02T00:00:00.000Z', drifts: [{ severity: 'high' }, { severity: 'low' }] },
    );

    // The baseline is untouched (different commit = different row).
    const bl = await verify.readVerifyLatest(REPO);
    expect(bl?.run.commitHash).toBe('main1');
    expect(bl?.drifts).toHaveLength(0);

    // The PR head's snapshot is readable per-commit.
    const head = await spec.loadSpec<{ drifts: Drift[] }>(
      { repoKey: REPO, commitSha: 'prhead' },
      'verifyState',
    );
    expect(head?.drifts).toHaveLength(2);
  });

  it('readVerifyHistory is the baseline runs over time — PR heads excluded', async () => {
    const verify = new PgVerifyStore(db);
    const spec = new PgSpecStore(db);
    await verify.writeVerifyLatest(REPO, latest('m1', '2026-01-01T00:00:00.000Z', []));
    await verify.writeVerifyLatest(REPO, latest('m2', '2026-01-03T00:00:00.000Z', [{ severity: 'high' }]));
    // a PR-head snapshot in between — must NOT appear in the trend
    await spec.saveSpec(
      { repoKey: REPO, commitSha: 'pr1' },
      'verifyState',
      { verifiedAt: '2026-01-02T00:00:00.000Z', drifts: [] },
    );

    const hist = await verify.readVerifyHistory(REPO);
    expect(hist.runs.map((r) => r.commitHash)).toEqual(['m1', 'm2']);
    // the current baseline is the latest one
    expect((await verify.readVerifyLatest(REPO))?.run.commitHash).toBe('m2');
  });

  it('diffs are derived, not stored — readVerifyDiff is always null', async () => {
    const store = new PgVerifyStore(db);
    await store.writeVerifyLatest(REPO, latest('c1', '2026-01-01T00:00:00.000Z', []));
    expect(await store.readVerifyDiff(REPO)).toBeNull();
  });
});
