/**
 * The hosted run history has two widths: the baseline trend (the default,
 * what the coverage views chart) and EVERY stored run — the pull-request head
 * runs the gate wrote included — for a repository's Runs list. Each entry
 * carries the envelope's provenance so the list needs no snapshot read.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type { GuardLatest, GuardRunEnvelope } from '@truecourse/shared';
import { PgGuardStore } from '../../packages/data-store/src/index';

const REPO = 'acme/api';

let client: PGlite;
let store: PgGuardStore;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  store = new PgGuardStore(d as unknown as Db);
});
afterEach(async () => {
  await client.close();
});

const summary = { total: 1, pass: 1, fail: 0, stale: 0, orphaned: 0, error: 0, blocked: 0 };

function run(env: Partial<GuardRunEnvelope> & Pick<GuardRunEnvelope, 'runId' | 'ranAt' | 'commit'>): GuardLatest {
  return {
    run: { branch: 'main', recipeFingerprint: 'sha256:r', ...env },
    summary,
    scenarios: [],
    sections: [],
  };
}

describe('PgGuardStore.readGuardHistory', () => {
  it('lists the baseline runs by default and every stored run with `all`, oldest first', async () => {
    await store.writeGuardLatest(REPO, run({ runId: 'r-main1', ranAt: '2026-01-01T00:00:00Z', commit: 'main1', origin: 'hosted' }));
    await store.writeGuardRun(
      REPO,
      run({ runId: 'r-head7', ranAt: '2026-01-02T00:00:00Z', commit: 'head7', branch: 'feature', pullRequest: 7, origin: 'hosted' }),
    );
    await store.writeGuardLatest(REPO, run({ runId: 'r-main2', ranAt: '2026-01-03T00:00:00Z', commit: 'main2', origin: 'hosted' }));

    const trend = await store.readGuardHistory(REPO);
    expect(trend.runs.map((r) => r.runId)).toEqual(['r-main1', 'r-main2']);

    const all = await store.readGuardHistory(REPO, { all: true });
    expect(all.runs.map((r) => [r.runId, r.pullRequest ?? null, r.origin ?? null])).toEqual([
      ['r-main1', null, 'hosted'],
      ['r-head7', 7, 'hosted'],
      ['r-main2', null, 'hosted'],
    ]);
    expect(all.runs[1]).toMatchObject({ branch: 'feature', commit: 'head7', summary });
  });

  it('carries no provenance keys for a run stored before they existed', async () => {
    await store.writeGuardRun(REPO, run({ runId: 'r-old', ranAt: '2026-01-01T00:00:00Z', commit: 'old1' }));
    const [entry] = (await store.readGuardHistory(REPO, { all: true })).runs;
    expect(entry).toBeDefined();
    expect('pullRequest' in entry!).toBe(false);
    expect('origin' in entry!).toBe(false);
  });
});
