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

async function link(over: Record<string, unknown> = {}) {
  await store.linkRepo({
    repoFullName: 'acme/api',
    installationId: 5,
    workspaceOrgId: 'org_A',
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-gate-handler-'));
  store = new FileGateStore(dir);
  await link();
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function violation(severity: string, over: Record<string, unknown> = {}): any {
  return { id: `v-${severity}`, ruleKey: 'r', severity, title: `${severity} issue`, filePath: 'src/a.ts', ...over };
}

function makeOctokit(opts: { comments?: { id: number; body: string; user?: { type: string } }[] } = {}) {
  const calls = {
    check: [] as any[], // completed Check results (the authoritative verdict)
    checkStart: [] as any[], // in-progress Checks opened at the start
    create: [] as any[],
    update: [] as any[],
  };
  const checkRuns = new Map<number, any>();
  let nextCheckId = 1000;
  const octokit: any = {
    paginate: async (m: any, p: any) => (await m(p)).data,
    checks: {
      create: async (p: any) => {
        const id = ++nextCheckId;
        if (p.status === 'in_progress') {
          calls.checkStart.push(p);
          checkRuns.set(id, p);
        } else {
          calls.check.push(p);
        }
        return { data: { id } };
      },
      update: async (p: any) => {
        const created = checkRuns.get(p.check_run_id) ?? {};
        calls.check.push({ ...p, head_sha: created.head_sha, name: created.name });
        return { data: { id: p.check_run_id } };
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

function depsWith(octokit: any, codeQualityAdded: any): GateHandlerDeps {
  return {
    store,
    octokitFor: () => octokit,
    runVerify: async () => ({ baseSha: 'basesha', headSha: 'headsha', codeQualityAdded }),
  } as unknown as GateHandlerDeps;
}

describe('handlePullRequestGate (Code Quality)', () => {
  it('fails the Check and comments on new violations at/above the threshold', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, [violation('high')]);

    await handlePullRequestGate(deps, prPayload());

    expect(calls.check).toHaveLength(1);
    expect(calls.check[0].status).toBe('completed');
    expect(calls.check[0].conclusion).toBe('failure');
    expect(calls.check[0].head_sha).toBe('headsha');
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0].body).toContain(GATE_MARKER);

    const runs = await store.listRuns('acme/api');
    expect(runs).toHaveLength(1);
    expect(runs[0].conclusion).toBe('failure');
    expect(runs[0].addedCount).toBe(1);
  });

  it('opens the Check as in-progress before completing it', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, []);

    await handlePullRequestGate(deps, prPayload());

    expect(calls.checkStart).toHaveLength(1);
    expect(calls.checkStart[0].status).toBe('in_progress');
    expect(calls.checkStart[0].head_sha).toBe('headsha');
    expect(calls.check).toHaveLength(1);
    expect(calls.check[0].status).toBe('completed');
  });

  it('passes when the PR introduces no new violations', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, []);
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check[0].conclusion).toBe('success');
    expect(calls.create).toHaveLength(1);
  });

  it('is neutral (no-baseline) when there is no baseline analysis to diff against', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, null);
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check[0].conclusion).toBe('neutral');
  });

  it('passes when all new violations are below the threshold', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, [violation('low')]);
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check[0].conclusion).toBe('success');
  });

  it('advisory mode (codeQualityBlocking off) marks new violations neutral, not failure', async () => {
    await link({ codeQualityBlocking: false });
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, [violation('high')]);
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check[0].conclusion).toBe('neutral');
  });

  it('refreshes an existing gate comment', async () => {
    const { octokit, calls } = makeOctokit({
      comments: [{ id: 88, body: renderGateComment({ conclusion: 'success', added: [], belowThreshold: [], total: 0 }), user: { type: 'Bot' } }],
    });
    const deps = depsWith(octokit, [violation('high')]);
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
    const deps = depsWith(octokit, [violation('high')]);
    await handlePullRequestGate(deps, prPayload());
    expect(calls.check).toHaveLength(0);
  });

  it('ignores non-gate actions and unconnected repos', async () => {
    const { octokit, calls } = makeOctokit();
    const deps = depsWith(octokit, []);
    await handlePullRequestGate(deps, prPayload({ action: 'closed' }));
    await handlePullRequestGate(
      deps,
      prPayload({ repository: { full_name: 'stranger/repo', default_branch: 'main' } }),
    );
    expect(calls.check).toHaveLength(0);
  });
});
