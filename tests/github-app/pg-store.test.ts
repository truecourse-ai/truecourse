import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
  PostgresGateStore,
  type GateDb,
  type InstallationRecord,
  type RepoLinkRecord,
  type GateRunRecord,
} from '../../ee/packages/github-app/src/index';
import { schema, MIGRATIONS_DIR, verifySnapshots } from '@truecourse/ee-db';

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

function repo(name: string, over: Partial<RepoLinkRecord> = {}): RepoLinkRecord {
  return {
    repoFullName: name,
    installationId: 1,
    workspaceOrgId: 'org_A',
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    notifyEmails: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
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

  it('round-trips repo links including notify_emails (text[]) and blocking', async () => {
    await store.linkRepo(repo('acme/api', { notifyEmails: ['a@x.com', 'b@y.com'], blocking: false }));
    const r = await store.getRepo('acme/api');
    expect(r?.notifyEmails).toEqual(['a@x.com', 'b@y.com']);
    expect(r?.blocking).toBe(false);

    await store.linkRepo(repo('acme/api', { notifyEmails: [], blocking: true }));
    const r2 = await store.getRepo('acme/api');
    expect(r2?.notifyEmails).toEqual([]);
    expect(r2?.blocking).toBe(true);

    await store.linkRepo(repo('acme/web', { workspaceOrgId: 'org_A' }));
    const forA = await store.listReposForWorkspace('org_A');
    expect(forA.map((x) => x.repoFullName)).toEqual(['acme/api', 'acme/web']);
  });

  it('baseline pointer + drifts from the baseline commit snapshot; null otherwise', async () => {
    const drift: any = {
      id: 'd1',
      artifactRef: { type: 'Operation', identity: 'GET /a' },
      obligationKey: 'ob1',
      severity: 'high',
      filePath: 'src/a.ts',
      lineStart: 1,
      lineEnd: 2,
      message: 'm',
    };
    // The baseline's drifts live in its verify_snapshot; gh_baselines is the pointer.
    await db.insert(verifySnapshots).values({
      repoKey: 'acme/api',
      commitSha: 'abc',
      branch: 'main',
      snapshot: { drifts: [drift] },
      driftCount: 1,
      bySeverity: { high: 1 },
      isBaseline: true,
      verifiedAt: '2026-01-02T00:00:00.000Z',
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    await store.saveBaseline({ repoFullName: 'acme/api', commitSha: 'abc', drifts: [drift], capturedAt: '2026-01-02T00:00:00.000Z' });
    const b = await store.getBaseline('acme/api');
    expect(b?.commitSha).toBe('abc');
    expect(b?.drifts?.[0].obligationKey).toBe('ob1');

    // No snapshot for the pointed commit → null drifts.
    await store.saveBaseline({ repoFullName: 'acme/web', commitSha: 'def', drifts: null, capturedAt: '2026-01-02T00:00:00.000Z' });
    expect((await store.getBaseline('acme/web'))?.drifts).toBeNull();
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

  it('cascades removeInstallation to repos, baselines, and runs', async () => {
    await store.saveInstallation(installation(1, 'org_A'));
    await store.linkRepo(repo('acme/api', { installationId: 1 }));
    await store.saveBaseline({ repoFullName: 'acme/api', commitSha: 'abc', drifts: [], capturedAt: '2026-01-02T00:00:00.000Z' });
    await store.recordRun({
      id: 'r1', repoFullName: 'acme/api', prNumber: 1, headSha: 's', baseSha: 'b',
      conclusion: 'success', addedCount: 0, resolvedCount: 0, createdAt: '2026-01-02T00:00:00.000Z',
    });

    await store.removeInstallation(1);
    expect(await store.getInstallation(1)).toBeNull();
    expect(await store.getRepo('acme/api')).toBeNull();
    expect(await store.getBaseline('acme/api')).toBeNull();
    expect(await store.listRuns('acme/api')).toEqual([]);
  });
});
