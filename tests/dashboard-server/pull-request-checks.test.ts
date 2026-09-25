/**
 * What a pull request event means for its check: a new head starts an
 * attempt (a row, a check posted on GitHub, a job in the lane) after
 * superseding the one in flight; a draft is held with a check that says so;
 * a close cancels; a re-run pressed on GitHub is a new attempt on the
 * current head. GitHub refusing the check is said once and stops nothing.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { PullRequestRecord } from '@truecourse/shared';
import type { OctokitClient } from '../../packages/github-app/src/octokit';
import { createPullRequestChecks } from '../../apps/dashboard/server/src/services/pull-request-checks.service';
import type { PullRequestCheckJobRequest } from '../../apps/dashboard/server/src/jobs/tasks/repo-pr-check';
import { memoryPullRequestStore, type MemoryPullRequestStore } from '../helpers/memory-pull-requests';
import { MemoryInstallationStore } from '../github-app/memory-store';

let pulls: MemoryPullRequestStore;
let repos: MemoryInstallationStore;
let enqueued: PullRequestCheckJobRequest[];
let cancelled: string[];
let github: { method: string; params: Record<string, unknown> }[];
let refuseCreate: boolean;
let jobIds: number;

const octokit = {
  checks: {
    create: async (params: Record<string, unknown>) => {
      github.push({ method: 'create', params });
      if (refuseCreate) throw Object.assign(new Error('Resource not accessible by integration'), { status: 403 });
      return { data: { id: 900 + github.length } };
    },
    update: async (params: Record<string, unknown>) => {
      github.push({ method: 'update', params });
      return { data: {} };
    },
  },
} as unknown as OctokitClient;

function pr(over: Partial<PullRequestRecord> = {}): PullRequestRecord {
  return {
    repoFullName: 'acme/api',
    number: 7,
    workspaceOrgId: 'org_A',
    provider: 'github',
    title: 'Add widgets',
    authorLogin: 'octocat',
    headSha: 'head-1',
    headRef: 'feature',
    baseRef: 'main',
    headRepoFullName: 'acme/api',
    draft: false,
    state: 'open',
    openedAt: '2026-09-20T10:00:00.000Z',
    closedAt: null,
    updatedAt: '2026-09-21T10:00:00.000Z',
    ...over,
  };
}

const checks = () =>
  createPullRequestChecks({
    pulls,
    repos,
    octokitFor: () => octokit,
    jobs: {
      enqueuePullRequestCheck: async (request) => {
        enqueued.push(request);
        jobIds += 1;
        return { status: 'queued', jobId: `job_${jobIds}` };
      },
      cancel: async (jobId) => {
        cancelled.push(jobId);
        return 'cancelled';
      },
    },
  });

beforeEach(async () => {
  pulls = memoryPullRequestStore();
  repos = new MemoryInstallationStore();
  enqueued = [];
  cancelled = [];
  github = [];
  refuseCreate = false;
  jobIds = 0;
  await repos.linkRepo({
    repoFullName: 'acme/api',
    provider: 'github',
    accountId: '5',
    workspaceOrgId: 'org_A',
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  await pulls.savePullRequest(pr());
});

describe('a head to check', () => {
  it('makes an attempt: a row, a queued check on GitHub carrying its id, and a job in the lane', async () => {
    await checks().onPullRequest({ pr: pr(), installationId: 5, effect: 'check' });

    const [check] = pulls.checks;
    expect(check).toMatchObject({ number: 7, headSha: 'head-1', attempt: 1, status: 'queued', githubCheckRunId: 901, jobId: 'job_1' });
    expect(github).toEqual([
      { method: 'create', params: expect.objectContaining({ head_sha: 'head-1', external_id: check!.id, status: 'queued' }) },
    ]);
    expect(enqueued).toEqual([
      {
        repoId: 'acme-api',
        repoFullName: 'acme/api',
        workspaceOrgId: 'org_A',
        source: 'pull-request',
        number: 7,
        headSha: 'head-1',
        checkId: check!.id,
        installationId: 5,
      },
    ]);
  });

  it('supersedes the attempt in flight: its row settles, its job stops, GitHub is told', async () => {
    const service = checks();
    await service.onPullRequest({ pr: pr(), installationId: 5, effect: 'check' });
    // The webhook saved the new head before it said so.
    await pulls.savePullRequest(pr({ headSha: 'head-2' }));
    await service.onPullRequest({ pr: pr({ headSha: 'head-2' }), installationId: 5, effect: 'check' });

    const [first, second] = pulls.checks;
    expect(first).toMatchObject({ headSha: 'head-1', status: 'settled', conclusion: 'neutral', reason: 'superseded' });
    expect(second).toMatchObject({ headSha: 'head-2', status: 'queued', attempt: 1 });
    expect(cancelled).toEqual(['job_1']);
    const updates = github.filter((c) => c.method === 'update');
    expect(updates).toHaveLength(1);
    expect(updates[0]!.params).toMatchObject({ check_run_id: 901, status: 'completed', conclusion: 'neutral' });
    expect(enqueued.map((r) => r.headSha)).toEqual(['head-1', 'head-2']);
  });

  it('runs the check here and posts nothing when GitHub refuses it, saying so once', async () => {
    refuseCreate = true;
    const service = checks();
    await service.onPullRequest({ pr: pr(), installationId: 5, effect: 'check' });
    await pulls.savePullRequest(pr({ headSha: 'head-2' }));
    await service.onPullRequest({ pr: pr({ headSha: 'head-2' }), installationId: 5, effect: 'check' });
    expect(pulls.checks.map((c) => c.githubCheckRunId)).toEqual([null, null]);
    expect(enqueued).toHaveLength(2);
    // Nothing was ever posted, so nothing is updated either.
    expect(github.filter((c) => c.method === 'update')).toEqual([]);
  });

  it('starts nothing, and supersedes nothing, for a head the pull request no longer has', async () => {
    const service = checks();
    await service.onPullRequest({ pr: pr(), installationId: 5, effect: 'check' });
    // A push landed between a re-run's read and its start.
    await pulls.savePullRequest(pr({ headSha: 'head-2' }));
    expect(await service.start(pr({ headSha: 'head-1' }))).toEqual({ status: 'stale' });
    expect(pulls.checks.map((c) => [c.headSha, c.status])).toEqual([['head-1', 'queued']]);
    expect(cancelled).toEqual([]);
  });
});

describe('a draft', () => {
  it('is held: a check settled at once, saying it is checked when ready', async () => {
    await checks().onPullRequest({ pr: pr({ draft: true }), installationId: 5, effect: 'draft' });
    const [check] = pulls.checks;
    expect(check).toMatchObject({ status: 'settled', conclusion: 'neutral', reason: 'draft', jobId: null });
    expect(enqueued).toEqual([]);
    expect(github.map((c) => c.method)).toEqual(['create', 'update']);
    expect(github[1]!.params).toMatchObject({
      status: 'completed',
      conclusion: 'neutral',
      output: expect.objectContaining({ title: 'Checked when ready for review' }),
    });
  });

  it('supersedes the attempt a conversion to draft interrupts', async () => {
    const service = checks();
    await service.onPullRequest({ pr: pr(), installationId: 5, effect: 'check' });
    await service.onPullRequest({ pr: pr({ draft: true }), installationId: 5, effect: 'draft' });
    expect(pulls.checks.map((c) => c.reason)).toEqual(['superseded', 'draft']);
    expect(cancelled).toEqual(['job_1']);
  });
});

describe('a close', () => {
  it('cancels the attempt in flight and starts nothing', async () => {
    const service = checks();
    await service.onPullRequest({ pr: pr(), installationId: 5, effect: 'check' });
    await service.onPullRequest({ pr: pr({ state: 'merged' }), installationId: 5, effect: 'close' });
    expect(pulls.checks.map((c) => [c.status, c.reason])).toEqual([['settled', 'cancelled']]);
    expect(cancelled).toEqual(['job_1']);
    await service.onPullRequest({ pr: pr({ state: 'merged' }), installationId: 5, effect: 'close' });
    expect(pulls.checks).toHaveLength(1);
  });

  it('a title edit starts nothing', async () => {
    await checks().onPullRequest({ pr: pr(), installationId: 5, effect: 'none' });
    expect(pulls.checks).toEqual([]);
  });
});

describe('a conflict resolved', () => {
  it('re-checks every open pull request whose latest check stopped on a conflict', async () => {
    const service = checks();
    await pulls.savePullRequest(pr({ number: 8, headSha: 'head-8' }));
    await pulls.savePullRequest(pr({ number: 9, headSha: 'head-9', draft: true }));
    for (const [number, reason] of [
      [7, 'conflict'],
      [8, 'clean'],
      [9, 'conflict'],
    ] as const) {
      const row = await pulls.createCheck({ repoFullName: 'acme/api', number, headSha: `head-${number === 7 ? 1 : number}` });
      await pulls.updateCheck(row.id, { status: 'settled', conclusion: reason === 'conflict' ? 'failure' : 'success', reason });
    }
    await service.rerunBlockedByConflict('org_A');
    // #7 stopped on a conflict: checked again. #8 was clean, #9 is a draft.
    expect(enqueued.map((r) => r.number)).toEqual([7]);
  });

  it('re-checks a repository only a context source reads, through the source’s installation', async () => {
    const service = createPullRequestChecks({
      pulls,
      repos,
      octokitFor: () => octokit,
      sourceInstallationOf: async (org, repoFullName) => (org === 'org_A' && repoFullName === 'acme/docs' ? 9 : null),
      jobs: {
        enqueuePullRequestCheck: async (request) => {
          enqueued.push(request);
          return { status: 'queued', jobId: 'job_docs' };
        },
        cancel: async () => 'cancelled',
      },
    });
    await pulls.savePullRequest(pr({ repoFullName: 'acme/docs', headRepoFullName: 'acme/docs', number: 3, headSha: 'head-3' }));
    const row = await pulls.createCheck({ repoFullName: 'acme/docs', number: 3, headSha: 'head-3' });
    await pulls.updateCheck(row.id, { status: 'settled', conclusion: 'failure', reason: 'conflict' });
    await service.rerunBlockedByConflict('org_A');
    expect(enqueued).toEqual([expect.objectContaining({ repoFullName: 'acme/docs', repoId: 'acme/docs', number: 3, installationId: 9 })]);
  });
});

describe('a re-run', () => {
  it('by check id is a new attempt on the current head', async () => {
    const service = checks();
    await service.onPullRequest({ pr: pr(), installationId: 5, effect: 'check' });
    await pulls.updateCheck(pulls.checks[0]!.id, { status: 'settled', conclusion: 'failure', reason: 'new-failures' });
    await service.onCheckRerun({
      repoFullName: 'acme/api',
      workspaceOrgId: 'org_A',
      installationId: 5,
      headSha: 'head-1',
      checkId: pulls.checks[0]!.id,
    });
    expect(pulls.checks.map((c) => [c.headSha, c.attempt, c.status])).toEqual([
      ['head-1', 1, 'settled'],
      ['head-1', 2, 'queued'],
    ]);
    expect(enqueued).toHaveLength(2);
  });

  it('by head re-judges every open pull request at that head, and never a head the pull request left', async () => {
    const service = checks();
    await service.onPullRequest({ pr: pr(), installationId: 5, effect: 'check' });
    // The pull request moved on: a re-run of the old head is nobody's.
    await pulls.savePullRequest(pr({ headSha: 'head-2' }));
    await service.onCheckRerun({ repoFullName: 'acme/api', workspaceOrgId: 'org_A', installationId: 5, headSha: 'head-1', checkId: null });
    expect(enqueued).toHaveLength(1);
    await pulls.savePullRequest(pr({ headSha: 'head-1' }));
    await service.onCheckRerun({ repoFullName: 'acme/api', workspaceOrgId: 'org_A', installationId: 5, headSha: 'head-1', checkId: null });
    expect(enqueued).toHaveLength(2);
    expect(pulls.checks.at(-1)).toMatchObject({ headSha: 'head-1', attempt: 2, status: 'queued' });
  });
});
