/**
 * The pull request routes: a repository's pull requests with their latest
 * check in one line, one check with its report, a re-run as a new attempt,
 * and the workspace-wide read Context draws its pull request rows from. A
 * repository another workspace connected is not found, as everywhere.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
vi.mock('../../apps/dashboard/server/src/observability/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../apps/dashboard/server/src/observability/posthog')>()),
  captureAction: vi.fn(),
}));
import type { PullRequestCheckReport, PullRequestRecord } from '@truecourse/shared';
import { resetContextStore, setContextStore } from '@truecourse/core/lib/context-store';
import { resetSpecStore, saveWorkspaceSpec, setSpecStore } from '@truecourse/core/lib/spec-store';
import { createTestApp, TEST_ORG } from '../helpers/test-app';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-fixture';
import { memoryContextStore } from '../helpers/memory-context-store';
import { memorySpecStore } from '../helpers/memory-spec-store';
import { memoryPullRequestStore, type MemoryPullRequestStore } from '../helpers/memory-pull-requests';
import type { CheckStart, PullRequestChecks } from '../../apps/dashboard/server/src/services/pull-request-checks.service';

let app: Express;
let fixture: TestFixture;
let pulls: MemoryPullRequestStore;
let started: PullRequestRecord[];
let rechecked: string[];
let startAnswer: CheckStart;

const checks: PullRequestChecks = {
  start: async (pr) => {
    started.push(pr);
    return startAnswer;
  },
  supersede: async () => {},
  rerunBlockedByConflict: async (org) => {
    rechecked.push(org);
  },
  onPullRequest: async () => {},
  onCheckRerun: async () => {},
};

function pr(number: number, over: Partial<PullRequestRecord> = {}): PullRequestRecord {
  return {
    repoFullName: fixture.project.name,
    number,
    workspaceOrgId: TEST_ORG,
    provider: 'github',
    title: `PR ${number}`,
    authorLogin: 'octocat',
    headSha: `head-${number}`,
    headRef: 'feature',
    baseRef: 'main',
    headRepoFullName: fixture.project.name,
    draft: false,
    state: 'open',
    openedAt: '2026-09-20T10:00:00.000Z',
    closedAt: null,
    updatedAt: `2026-09-21T10:0${number}:00.000Z`,
    ...over,
  };
}

const report = (over: Partial<PullRequestCheckReport> = {}): PullRequestCheckReport => ({
  base: { mergeBase: 'b', commit: 'b', nearestWithBase: null },
  fork: false,
  conflictsCreated: [],
  sectionsMoved: [],
  repositoriesAffected: [],
  run: {
    runId: 'run-1',
    counts: { newFailures: 1, preExisting: 2, fixed: 3, newlyBlocked: 0, added: 0, retired: 0 },
    newFailures: [{ id: 'f1', title: 'Login', scenarioIds: ['s1'] }],
    preExisting: [],
    fixed: [],
    newlyBlocked: [],
  },
  specHalf: 'no-documents-changed',
  codeHalf: 'ran',
  ...over,
});

beforeEach(async () => {
  fixture = await setupTestFixture();
  pulls = memoryPullRequestStore();
  started = [];
  rechecked = [];
  startAnswer = { status: 'queued', checkId: 'check_new', jobId: 'job_new' };
  setContextStore(memoryContextStore());
  setSpecStore(memorySpecStore());
  app = createTestApp({ pulls: { store: pulls, checks } });
});

afterEach(async () => {
  resetContextStore();
  resetSpecStore();
  await teardownTestFixture(fixture.project.slug);
});

describe('GET /api/repos/:id/pulls', () => {
  it('lists the repository’s open pull requests, newest update first, each with its latest check in one line', async () => {
    await pulls.savePullRequest(pr(1));
    await pulls.savePullRequest(pr(2, { state: 'closed' }));
    await pulls.savePullRequest(pr(3));
    const old = await pulls.createCheck({ repoFullName: fixture.project.name, number: 3, headSha: 'head-3' });
    await pulls.updateCheck(old.id, { status: 'settled', conclusion: 'neutral', reason: 'superseded' });
    const latest = await pulls.createCheck({ repoFullName: fixture.project.name, number: 3, headSha: 'head-3' });
    await pulls.updateCheck(latest.id, {
      status: 'settled',
      conclusion: 'failure',
      reason: 'new-failures',
      report: report({ sectionsMoved: [{ doc: 'd', anchor: 'a', flows: [] }] }),
      settledAt: '2026-09-21T11:00:00.000Z',
    });

    const res = await request(app).get(`/api/repos/${fixture.project.slug}/pulls`).expect(200);
    expect(res.body.pullRequests.map((p: { number: number }) => p.number)).toEqual([3, 1]);
    expect(res.body.pullRequests[0].check).toEqual({
      id: latest.id,
      attempt: 2,
      status: 'settled',
      conclusion: 'failure',
      reason: 'new-failures',
      createdAt: latest.createdAt,
      settledAt: '2026-09-21T11:00:00.000Z',
      counts: { conflictsCreated: 0, sectionsMoved: 1, newFailures: 1, preExisting: 2, fixed: 3 },
    });
    expect(res.body.pullRequests[1].check).toBeNull();

    const all = await request(app).get(`/api/repos/${fixture.project.slug}/pulls?state=all`).expect(200);
    expect(all.body.pullRequests.map((p: { number: number }) => p.number)).toEqual([3, 2, 1]);
    await request(app).get(`/api/repos/${fixture.project.slug}/pulls?state=maybe`).expect(400);
  });

  it('answers 404 for a repository this workspace did not connect', async () => {
    await request(app).get('/api/repos/nobodys-repo/pulls').expect(404);
  });

  it('leaves out, refuses to read and refuses to re-run a pull request another workspace checked', async () => {
    // The repository was a context source of another workspace before this
    // one connected it; the rows its checks left are that workspace's.
    await pulls.savePullRequest(pr(1, { workspaceOrgId: 'org_other' }));
    await pulls.savePullRequest(pr(2));
    const check = await pulls.createCheck({ repoFullName: fixture.project.name, number: 1, headSha: 'head-1' });
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/pulls`).expect(200);
    expect(res.body.pullRequests.map((p: { number: number }) => p.number)).toEqual([2]);
    await request(app).get(`/api/repos/${fixture.project.slug}/pulls/1/checks/${check.id}`).expect(404);
    await request(app).post(`/api/repos/${fixture.project.slug}/pulls/1/rerun`).expect(404);
    expect(started).toEqual([]);
  });
});

describe('GET /api/repos/:id/pulls/:number/checks/:checkId', () => {
  it('answers one check with its report, and 404 for a check of another pull request', async () => {
    await pulls.savePullRequest(pr(1));
    const check = await pulls.createCheck({ repoFullName: fixture.project.name, number: 1, headSha: 'head-1' });
    await pulls.updateCheck(check.id, { status: 'settled', conclusion: 'success', reason: 'clean', report: report() });
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/pulls/1/checks/${check.id}`).expect(200);
    expect(res.body.check).toMatchObject({ id: check.id, reason: 'clean', report: report() });
    await request(app).get(`/api/repos/${fixture.project.slug}/pulls/2/checks/${check.id}`).expect(404);
    await request(app).get(`/api/repos/${fixture.project.slug}/pulls/1/checks/nope`).expect(404);
  });
});

describe('POST /api/repos/:id/pulls/:number/rerun', () => {
  it('starts a new attempt on the current head and answers 202 with it', async () => {
    await pulls.savePullRequest(pr(1));
    const res = await request(app).post(`/api/repos/${fixture.project.slug}/pulls/1/rerun`).expect(202);
    expect(res.body).toEqual({ checkId: 'check_new', jobId: 'job_new' });
    expect(started.map((p) => p.number)).toEqual([1]);
  });

  it('refuses a closed pull request, an unknown one, a draft, one being checked, and a busy start', async () => {
    await pulls.savePullRequest(pr(1, { state: 'merged' }));
    await request(app).post(`/api/repos/${fixture.project.slug}/pulls/1/rerun`).expect(409);
    await request(app).post(`/api/repos/${fixture.project.slug}/pulls/9/rerun`).expect(404);
    await pulls.savePullRequest(pr(3, { draft: true }));
    await request(app).post(`/api/repos/${fixture.project.slug}/pulls/3/rerun`).expect(409);
    await pulls.savePullRequest(pr(4));
    await pulls.createCheck({ repoFullName: fixture.project.name, number: 4, headSha: 'head-4' });
    await request(app).post(`/api/repos/${fixture.project.slug}/pulls/4/rerun`).expect(409);
    expect(started).toEqual([]);
    await pulls.savePullRequest(pr(2));
    startAnswer = { status: 'busy' };
    await request(app).post(`/api/repos/${fixture.project.slug}/pulls/2/rerun`).expect(409);
  });

  it('answers 503 when GitHub is not configured', async () => {
    app = createTestApp({ pulls: { store: pulls, checks: null } });
    await pulls.savePullRequest(pr(1));
    await request(app).post(`/api/repos/${fixture.project.slug}/pulls/1/rerun`).expect(503);
  });
});

describe('GET /api/context/pull-requests', () => {
  it('lists the workspace’s open pull requests whose latest check settled, with what they created and moved', async () => {
    await pulls.savePullRequest(pr(1));
    await pulls.savePullRequest(pr(2));
    await pulls.savePullRequest(pr(3, { state: 'closed' }));
    const settled = await pulls.createCheck({ repoFullName: fixture.project.name, number: 1, headSha: 'head-1' });
    const created = [
      { docs: ['a', 'b'] as [string, string], sections: [['x'], ['y']] as [string[], string[]], note: 'n', path: 'a.md', line: 3, blocksRepositories: [] },
    ];
    await pulls.updateCheck(settled.id, {
      status: 'settled',
      conclusion: 'failure',
      reason: 'conflict',
      report: report({ run: null, codeHalf: 'stopped-by-conflict', conflictsCreated: created }),
      settledAt: '2026-09-21T11:00:00.000Z',
    });
    // #2's check is still running; #3 is closed.
    await pulls.createCheck({ repoFullName: fixture.project.name, number: 2, headSha: 'head-2' });
    const closed = await pulls.createCheck({ repoFullName: fixture.project.name, number: 3, headSha: 'head-3' });
    await pulls.updateCheck(closed.id, { status: 'settled', conclusion: 'success', reason: 'clean', report: report() });

    const res = await request(app).get('/api/context/pull-requests').expect(200);
    expect(res.body.pullRequests.map((p: { number: number }) => p.number)).toEqual([1]);
    expect(res.body.pullRequests[0].check).toEqual({
      id: settled.id,
      conclusion: 'failure',
      reason: 'conflict',
      settledAt: '2026-09-21T11:00:00.000Z',
      conflictsCreated: created,
      sectionsMoved: [],
    });
  });
});

describe('POST /api/context/conflict-resolution', () => {
  it('re-checks the pull requests a conflict blocked once one is resolved', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [],
      areas: [],
      skippedDocs: [],
    });
    await request(app)
      .post('/api/context/conflict-resolution')
      .send({ docA: 'context/s/a.md', anchorA: 'A', docB: 'context/s/b.md', anchorB: 'B', verdict: 'a' })
      .expect(200);
    expect(rechecked).toEqual([TEST_ORG]);
  });
});
