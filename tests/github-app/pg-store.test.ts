import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  PostgresGateStore,
  type GateDb,
  type InstallationRecord,
  type GateRunRecord,
} from '../../packages/github-app/src/index';
import { schema, MIGRATIONS_DIR } from '@truecourse/db';

let client: PGlite;
let db: ReturnType<typeof drizzle>;
let store: PostgresGateStore;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  store = new PostgresGateStore(db as unknown as GateDb, () => client.close());
});

afterEach(async () => {
  await store.close();
});

function installation(id: number, org: string | null = null): InstallationRecord {
  return {
    installationId: id,
    accountLogin: `acct-${id}`,
    accountType: 'Organization',
    workspaceOrgId: org,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('PostgresGateStore (Drizzle, validated against pglite)', () => {
  it('round-trips installations with the COALESCE upsert', async () => {
    await store.saveInstallation(installation(1, 'org_A'));
    expect((await store.getInstallation(1))?.workspaceOrgId).toBe('org_A');

    // A re-sent install with no workspace must preserve the existing link.
    await store.saveInstallation(installation(1, null));
    expect((await store.getInstallation(1))?.workspaceOrgId).toBe('org_A');

    await store.linkInstallationToWorkspace(1, 'org_B');
    expect((await store.getInstallation(1))?.workspaceOrgId).toBe('org_B');
    expect(await store.getInstallation(999)).toBeNull();
  });

  it('baseline pointer round-trips; null for an unknown repo', async () => {
    await store.saveBaseline({ repoFullName: 'acme/api', commitSha: 'abc', capturedAt: '2026-01-02T00:00:00.000Z' });
    const b = await store.getBaseline('acme/api');
    expect(b?.commitSha).toBe('abc');

    // Overwrites the pointer (singleton per repo).
    await store.saveBaseline({ repoFullName: 'acme/api', commitSha: 'def', capturedAt: '2026-01-03T00:00:00.000Z' });
    expect((await store.getBaseline('acme/api'))?.commitSha).toBe('def');

    expect(await store.getBaseline('nope/none')).toBeNull();
  });

  it('records runs most-recent-first and honors the limit', async () => {
    const mk = (id: string, n: number): GateRunRecord => ({
      id, repoFullName: 'acme/api', prNumber: n, headSha: `sha${n}`, baseSha: 'base',
      conclusion: 'failure', addedCount: n, resolvedCount: 0, createdAt: `2026-01-0${n}T00:00:00.000Z`,
    });
    await store.recordRun(mk('r1', 1));
    await store.recordRun(mk('r2', 2));
    await store.recordRun(mk('r3', 3));
    const runs = await store.listRuns('acme/api');
    expect(runs.map((r) => r.id)).toEqual(['r3', 'r2', 'r1']);
    expect(runs[0].conclusion).toBe('failure');
    expect(await store.listRuns('acme/api', 1)).toHaveLength(1);
  });

  it('upserts PR state with the composite-key conflict update, scoped per repo', async () => {
    await store.upsertPr({
      repoFullName: 'acme/api', prNumber: 7, title: 'Add widget', state: 'open',
      headSha: 'aaa', updatedAt: '2026-01-02T00:00:00.000Z',
    });
    await store.upsertPr({
      repoFullName: 'acme/api', prNumber: 8, title: 'Fix bug', state: 'open',
      headSha: 'bbb', updatedAt: '2026-01-02T00:00:00.000Z',
    });
    await store.upsertPr({
      repoFullName: 'other/web', prNumber: 7, title: 'Unrelated', state: 'closed',
      headSha: 'ccc', updatedAt: '2026-01-02T00:00:00.000Z',
    });

    expect((await store.listPrs('acme/api')).map((p) => p.prNumber).sort()).toEqual([7, 8]);
    expect(await store.listPrs('nope/none')).toEqual([]);

    // Re-upsert #7 merged → updates in place, no duplicate row.
    await store.upsertPr({
      repoFullName: 'acme/api', prNumber: 7, title: 'Add widget', state: 'merged',
      headSha: 'ddd', updatedAt: '2026-01-03T00:00:00.000Z',
    });
    const prs = await store.listPrs('acme/api');
    expect(prs).toHaveLength(2);
    expect(prs.find((p) => p.prNumber === 7)?.state).toBe('merged');
    expect(prs.find((p) => p.prNumber === 7)?.headSha).toBe('ddd');
    expect((await store.listPrs('other/web'))[0].state).toBe('closed');
  });

  it('removes an installation, leaving the gate rows of its repositories alone', async () => {
    // The repositories an installation brought are disconnected one at a time,
    // by the webhook, which is also what purges their per-repository rows; the
    // account row going is the whole of this.
    await store.saveInstallation(installation(1, 'org_A'));
    await store.saveBaseline({ repoFullName: 'acme/api', commitSha: 'abc', capturedAt: '2026-01-02T00:00:00.000Z' });

    await store.removeInstallation(1);
    expect(await store.getInstallation(1)).toBeNull();
    expect((await store.getBaseline('acme/api'))?.commitSha).toBe('abc');
  });

  it('keeps one workspace\'s installations apart from another\'s', async () => {
    await store.saveInstallation(installation(1, 'org_A'));
    await store.saveInstallation(installation(2, 'org_B'));
    expect((await store.listInstallationsForWorkspace('org_A')).map((i) => i.installationId)).toEqual([1]);
    expect((await store.listInstallationsForWorkspace('org_B')).map((i) => i.installationId)).toEqual([2]);
  });
});
