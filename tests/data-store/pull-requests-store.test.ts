/**
 * Pull requests and their checks in Postgres (PGlite + the real migrations):
 * a pull request is upserted by (repository, number), a workspace's list goes
 * is the rows' own workspace, and a check is one attempt on a head — the
 * attempt numbered per head, the status only ever moved forward.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { PullRequestRecord } from '@truecourse/shared';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgPullRequestStore, PgRepositoryStore } from '@truecourse/data-store';

let client: PGlite;
let db: Db;
let store: PgPullRequestStore;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  store = new PgPullRequestStore(db);
  const repos = new PgRepositoryStore(db);
  for (const [name, org] of [
    ['acme/api', 'org_A'],
    ['acme/web', 'org_A'],
    ['other/repo', 'org_B'],
  ] as const) {
    await repos.linkRepo({
      repoFullName: name,
      provider: 'github',
      accountId: '1',
      workspaceOrgId: org,
      defaultBranch: 'main',
      blocking: true,
      enabled: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  }
});

afterEach(async () => {
  await client.close();
});

function pr(repoFullName: string, number: number, over: Partial<PullRequestRecord> = {}): PullRequestRecord {
  return {
    repoFullName,
    number,
    workspaceOrgId: 'org_A',
    provider: 'github',
    title: `PR ${number}`,
    authorLogin: 'octocat',
    headSha: `head-${number}`,
    headRef: 'feature',
    baseRef: 'main',
    headRepoFullName: repoFullName,
    draft: false,
    state: 'open',
    openedAt: '2026-09-20T10:00:00.000Z',
    closedAt: null,
    updatedAt: `2026-09-21T10:0${number}:00.000Z`,
    ...over,
  };
}

describe('pull requests', () => {
  it('round-trips a row, and a second save of the same number replaces it', async () => {
    await store.savePullRequest(pr('acme/api', 7));
    expect(await store.getPullRequest('acme/api', 7)).toEqual(pr('acme/api', 7));
    await store.savePullRequest(pr('acme/api', 7, { title: 'renamed', headSha: 'head-7b', state: 'merged', closedAt: '2026-09-22T00:00:00.000Z' }));
    expect(await store.getPullRequest('acme/api', 7)).toMatchObject({
      title: 'renamed',
      headSha: 'head-7b',
      state: 'merged',
      closedAt: '2026-09-22T00:00:00.000Z',
    });
    expect(await store.getPullRequest('acme/api', 8)).toBeNull();
  });

  it('lists one repository newest update first, narrowed by state', async () => {
    await store.savePullRequest(pr('acme/api', 1));
    await store.savePullRequest(pr('acme/api', 2, { state: 'closed' }));
    await store.savePullRequest(pr('acme/api', 3));
    await store.savePullRequest(pr('acme/web', 4));
    expect((await store.listPullRequests('acme/api')).map((p) => p.number)).toEqual([3, 2, 1]);
    expect((await store.listPullRequests('acme/api', { state: 'open' })).map((p) => p.number)).toEqual([3, 1]);
    expect((await store.listPullRequests('acme/api', { state: 'closed' })).map((p) => p.number)).toEqual([2]);
  });

  it('lists a workspace by the rows’ own workspace, a repository only a source reads included', async () => {
    await store.savePullRequest(pr('acme/api', 1));
    // No `repositories` row: the workspace reads it as a context source only.
    await store.savePullRequest(pr('acme/handbook', 2));
    await store.savePullRequest(pr('other/repo', 3, { workspaceOrgId: 'org_B' }));
    expect((await store.listWorkspacePullRequests('org_A')).map((p) => p.number)).toEqual([2, 1]);
    expect((await store.listWorkspacePullRequests('org_B')).map((p) => p.number)).toEqual([3]);
  });
});

describe('checks', () => {
  beforeEach(async () => {
    await store.savePullRequest(pr('acme/api', 7));
  });

  it('numbers attempts per head, from one', async () => {
    const first = await store.createCheck({ repoFullName: 'acme/api', number: 7, headSha: 'h1', jobId: 'job_1' });
    const second = await store.createCheck({ repoFullName: 'acme/api', number: 7, headSha: 'h1' });
    const other = await store.createCheck({ repoFullName: 'acme/api', number: 7, headSha: 'h2' });
    expect([first.attempt, second.attempt, other.attempt]).toEqual([1, 2, 1]);
    expect(first).toMatchObject({ status: 'queued', conclusion: null, reason: null, jobId: 'job_1', report: null });
    expect(await store.getCheck(first.id)).toEqual(first);
    expect((await store.listChecksForHead('acme/api', 'h1')).map((c) => c.attempt)).toEqual([2, 1]);
  });

  it('patches a check forward and answers the newest and the active one', async () => {
    const first = await store.createCheck({ repoFullName: 'acme/api', number: 7, headSha: 'h1' });
    const report = {
      base: { mergeBase: 'b', commit: 'b', nearestWithBase: null },
      fork: false,
      conflictsCreated: [],
      sectionsMoved: [],
      repositoriesAffected: [],
      run: null,
      specHalf: 'not-a-source' as const,
      codeHalf: 'not-run' as const,
    };
    const settled = await store.updateCheck(first.id, {
      status: 'settled',
      conclusion: 'neutral',
      reason: 'no-base',
      mergeBaseSha: 'b',
      baseCommitSha: null,
      githubCheckRunId: 9007199254740,
      report,
      settledAt: '2026-09-21T11:00:00.000Z',
    });
    expect(settled).toMatchObject({ status: 'settled', reason: 'no-base', githubCheckRunId: 9007199254740, report });
    expect(await store.activeCheck('acme/api', 7)).toBeNull();

    const second = await store.createCheck({ repoFullName: 'acme/api', number: 7, headSha: 'h2' });
    expect((await store.latestCheck('acme/api', 7))?.id).toBe(second.id);
    expect((await store.activeCheck('acme/api', 7))?.id).toBe(second.id);
    expect(await store.updateCheck('nope', { status: 'running' })).toBeNull();
  });
});
