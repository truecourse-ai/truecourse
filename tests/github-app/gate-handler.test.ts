import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FileGateStore,
  handlePullRequestGate,
  GATE_MARKER,
  renderGateComment,
  type GateHandlerDeps,
} from '../../ee/packages/github-app/src/index';

let dir: string;
let store: FileGateStore;

async function link(blocking = true) {
  await store.linkRepo({
    repoFullName: 'acme/api',
    installationId: 5,
    workspaceOrgId: 'org_A',
    defaultBranch: 'main',
    blocking,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-handler-'));
  store = new FileGateStore(dir);
  await link(true);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function drift(obligationKey: string, over: Record<string, unknown> = {}): any {
  return {
    id: `id-${obligationKey}`,
    artifactRef: { type: 'Operation', identity: 'GET /a' },
    obligationKey,
    severity: 'high',
    filePath: 'src/a.ts',
    lineStart: 10,
    lineEnd: 12,
    message: `drift ${obligationKey}`,
    ...over,
  };
}

function makeOctokit(opts: {
  comments?: { id: number; body: string; user?: { type: string } }[];
  reviewError?: number; // status code to throw from createReviewComment
} = {}) {
  const calls = {
    check: [] as any[],
    create: [] as any[],
    update: [] as any[],
    review: [] as any[],
  };
  const octokit: any = {
    paginate: async (m: any, p: any) => (await m(p)).data,
    checks: {
      create: async (p: any) => {
        calls.check.push(p);
        return { data: { id: 555 } };
      },
    },
    issues: {
      listComments: async () => ({ data: opts.comments ?? [] }),
      createComment: async (p: any) => {
        calls.create.push(p);
        return { data: { id: 1 } };
      },
      updateComment: async (p: any) => {
        calls.update.push(p);
      },
    },
    pulls: {
      listReviewComments: async () => ({ data: [] }),
      createReviewComment: async (p: any) => {
        calls.review.push(p);
        if (opts.reviewError) {
          const e: any = new Error('rejected');
          e.status = opts.reviewError;
          throw e;
        }
      },
    },
  };
  return { octokit, calls };
}

function prPayload(over: Record<string, unknown> = {}) {
  return {
    action: 'opened',
    number: 7,
    pull_request: {
      head: { sha: 'headsha', ref: 'feature', repo: { full_name: 'acme/api', fork: false } },
      base: { sha: 'b', ref: 'main' },
    },
    repository: { full_name: 'acme/api', default_branch: 'main' },
    installation: { id: 5 },
    ...over,
  } as any;
}

function depsWith(octokit: any, output: any): GateHandlerDeps {
  return {
    store,
    octokitFor: () => octokit,
    runVerify: async () => ({ baseSha: 'basesha', headSha: 'headsha', ...output }),
  } as unknown as GateHandlerDeps;
}

describe('handlePullRequestGate', () => {
  it('fails the Check, comments, and posts inline comments on new drift', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, { baseDrifts: [drift('a')], headDrifts: [drift('a'), drift('b')] });

    await handlePullRequestGate(deps, prPayload());

    expect(calls.check).toHaveLength(1);
    expect(calls.check[0].status).toBe('completed');
    expect(calls.check[0].conclusion).toBe('failure');
    expect(calls.check[0].head_sha).toBe('headsha');
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].body).toContain(GATE_MARKER);
    expect(calls.review).toHaveLength(1);
    expect(calls.review[0].path).toBe('src/a.ts');

    const runs = await store.listRuns('acme/api');
    expect(runs).toHaveLength(1);
    expect(runs[0].conclusion).toBe('failure');
    expect(runs[0].addedCount).toBe(1);
  });

  it('passes and posts no inline comments when there is no new drift', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, { baseDrifts: [drift('a')], headDrifts: [drift('a')] });
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check[0].conclusion).toBe('success');
    expect(calls.review).toHaveLength(0);
  });

  it('is neutral when the head has no contracts', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, { baseDrifts: [], headDrifts: null });
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check[0].conclusion).toBe('neutral');
  });

  it('is neutral (no-baseline) when the base has no contracts', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, { baseDrifts: null, headDrifts: [drift('b')] });
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check[0].conclusion).toBe('neutral');
  });

  it('completes the Check even when an inline comment is rejected (422)', async () => {
    const { octokit, calls } = makeOctokit({ reviewError: 422 });
    const deps = depsWith(octokit, { baseDrifts: [], headDrifts: [drift('b')] });
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check[0].conclusion).toBe('failure');
    expect(calls.create).toHaveLength(1);
  });

  it('refreshes an existing gate comment', async () => {
    const { octokit, calls } = makeOctokit({
      comments: [{ id: 88, body: renderGateComment({ conclusion: 'success', added: [], resolved: [], belowThreshold: [] }), user: { type: 'Bot' } }],
    });
    const deps = depsWith(octokit, { baseDrifts: [], headDrifts: [drift('b')] });
    await handlePullRequestGate(deps, prPayload());
    expect(calls.create).toHaveLength(0);
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0].comment_id).toBe(88);
  });

  it('skips a head sha that was already gated (redelivery)', async () => {
    await store.recordRun({
      id: 'r0', repoFullName: 'acme/api', prNumber: 7, headSha: 'headsha', baseSha: 'b',
      conclusion: 'success', addedCount: 0, resolvedCount: 0, createdAt: '2026-01-02T00:00:00.000Z',
    });
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, { baseDrifts: [], headDrifts: [drift('b')] });
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check).toHaveLength(0);
  });

  it('ignores non-gate actions and unconnected repos', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, { baseDrifts: [], headDrifts: [] });
    await handlePullRequestGate(deps, prPayload({ action: 'closed' }));
    await handlePullRequestGate(
      deps,
      prPayload({ repository: { full_name: 'stranger/repo', default_branch: 'main' } }),
    );
    expect(calls.check).toHaveLength(0);
  });

  it('advisory mode marks new drift neutral, not failure', async () => {
    await link(false);
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, { baseDrifts: [], headDrifts: [drift('b')] });
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check[0].conclusion).toBe('neutral');
  });

  it('emails the notify list on a blocking failure', async () => {
    const r = (await store.getRepo('acme/api'))!;
    await store.linkRepo({ ...r, notifyEmails: ['a@x.com'] });
    const { octokit } = makeOctokit();
    const sent: any[] = [];
    const deps = {
      store,
      octokitFor: () => octokit,
      runVerify: async () => ({ baseSha: 'b', headSha: 'headsha', baseDrifts: [], headDrifts: [drift('b')] }),
      notifier: { sendGateFailure: async (to: string[], e: any) => { sent.push({ to, e }); } },
    } as unknown as GateHandlerDeps;
    await handlePullRequestGate(deps, prPayload());
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['a@x.com']);
    expect(sent[0].e.prUrl).toContain('acme/api/pull/7');
  });

  it('does not email on a passing gate', async () => {
    const r = (await store.getRepo('acme/api'))!;
    await store.linkRepo({ ...r, notifyEmails: ['a@x.com'] });
    const { octokit } = makeOctokit();
    let sentCount = 0;
    const deps = {
      store,
      octokitFor: () => octokit,
      runVerify: async () => ({ baseSha: 'b', headSha: 'headsha', baseDrifts: [drift('a')], headDrifts: [drift('a')] }),
      notifier: { sendGateFailure: async () => { sentCount++; } },
    } as unknown as GateHandlerDeps;
    await handlePullRequestGate(deps, prPayload());
    expect(sentCount).toBe(0);
  });

  it('stays neutral and emails for resolution when the head spec has unresolved conflicts', async () => {
    const r = (await store.getRepo('acme/api'))!;
    await store.linkRepo({ ...r, notifyEmails: ['a@x.com'] });
    const { octokit, calls } = makeOctokit();
    const conflicts: any[] = [];
    const failures: any[] = [];
    const deps = {
      store,
      octokitFor: () => octokit,
      // Drift IS present, but the head's scan auto-defaulted 2 conflicts → the
      // gate must NOT fail on a guessed spec; it goes neutral and asks for help.
      runVerify: async () => ({
        baseSha: 'b',
        headSha: 'headsha',
        baseDrifts: [],
        headDrifts: [drift('b')],
        headConflicts: 2,
      }),
      notifier: {
        sendGateFailure: async (to: string[], e: any) => { failures.push({ to, e }); },
        sendConflictsNeedResolution: async (to: string[], e: any) => { conflicts.push({ to, e }); },
      },
    } as unknown as GateHandlerDeps;

    await handlePullRequestGate(deps, prPayload());

    // Neutral Check — not a failure, despite the new drift.
    expect(calls.check[0].conclusion).toBe('neutral');
    // No inline drift comments on an untrustworthy (conflicted) spec.
    expect(calls.review).toHaveLength(0);
    // Summary comment explains the spec needs resolution.
    expect(calls.create[0].body).toMatch(/unresolved conflict/i);
    // Emailed the conflict notice, NOT the failure notice.
    expect(failures).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].to).toEqual(['a@x.com']);
    expect(conflicts[0].e.openConflicts).toBe(2);

    const runs = await store.listRuns('acme/api');
    expect(runs[0].conclusion).toBe('neutral');
  });
});
