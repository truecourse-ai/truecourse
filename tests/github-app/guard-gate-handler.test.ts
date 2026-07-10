/**
 * Guard-gate webhook handler: a PR event opens the in-progress drift Check and
 * enqueues the durable `guard.gate` job with the fully-resolved request (repo,
 * PR, base/head SHAs, fork flag, and the Check id the job completes). Fast path
 * only — the heavy work lives in the job's pipeline.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileGateStore, GATE_CHECK_NAME } from '../../ee/packages/github-app/src/index';
import {
  handlePullRequestGuardGate,
  type GuardGateHandlerDeps,
} from '../../ee/packages/github-app/src/guard-gate-handler';
import type { GuardGateRunRequest } from '../../ee/packages/github-app/src/guard-gate-runner';

let dir: string;
let store: FileGateStore;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-gate-handler-'));
  store = new FileGateStore(dir);
  await store.linkRepo({
    repoFullName: 'acme/api',
    installationId: 5,
    workspaceOrgId: 'org_A',
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function makeOctokit(opts: { startCheckFails?: boolean } = {}) {
  const calls = { check: [] as any[], checkStart: [] as any[] };
  const checkRuns = new Map<number, any>();
  let nextCheckId = 500;
  const octokit: any = {
    checks: {
      create: async (p: any) => {
        if (p.status === 'in_progress') {
          if (opts.startCheckFails) throw new Error('checks API down');
          const id = ++nextCheckId;
          calls.checkStart.push(p);
          checkRuns.set(id, p);
          return { data: { id } };
        }
        calls.check.push(p);
        return { data: { id: ++nextCheckId } };
      },
      update: async (p: any) => {
        const created = checkRuns.get(p.check_run_id) ?? {};
        calls.check.push({ ...p, head_sha: created.head_sha, name: created.name });
        return { data: { id: p.check_run_id } };
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
      base: { sha: 'basesha', ref: 'main' },
    },
    repository: { full_name: 'acme/api', default_branch: 'main' },
    installation: { id: 5 },
    ...over,
  } as any;
}

function depsWith(
  octokit: any,
  enqueueResult: string | null = 'job-1',
): { deps: GuardGateHandlerDeps; enqueued: GuardGateRunRequest[] } {
  const enqueued: GuardGateRunRequest[] = [];
  const deps: GuardGateHandlerDeps = {
    store,
    octokitFor: () => octokit,
    enqueueGuardGate: async (req) => {
      enqueued.push(req);
      return enqueueResult;
    },
  };
  return { deps, enqueued };
}

describe('handlePullRequestGuardGate', () => {
  it('opens an in-progress drift Check and enqueues the resolved gate request', async () => {
    const { octokit, calls } = makeOctokit();
    const { deps, enqueued } = depsWith(octokit);

    await handlePullRequestGuardGate(deps, prPayload());

    expect(calls.checkStart).toHaveLength(1);
    expect(calls.checkStart[0]).toMatchObject({
      name: GATE_CHECK_NAME,
      head_sha: 'headsha',
      status: 'in_progress',
    });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toEqual({
      repoFullName: 'acme/api',
      installationId: 5,
      workspaceOrgId: 'org_A',
      prNumber: 7,
      defaultBranch: 'main',
      baseBranch: 'main',
      baseSha: 'basesha',
      headSha: 'headsha',
      headRef: 'feature',
      isFork: false,
      checkRunId: 501,
    });
    // Nothing completed — the queued job owns the Check's verdict.
    expect(calls.check).toHaveLength(0);
  });

  it('resolves isFork from the head repo (fork PRs gate via the pull ref)', async () => {
    const { octokit } = makeOctokit();
    const { deps, enqueued } = depsWith(octokit);

    await handlePullRequestGuardGate(
      deps,
      prPayload({
        pull_request: {
          head: { sha: 'headsha', ref: 'feature', repo: { full_name: 'fork/api', fork: true } },
          base: { sha: 'basesha', ref: 'main' },
        },
      }),
    );

    expect(enqueued[0].isFork).toBe(true);
    expect(enqueued[0].repoFullName).toBe('acme/api'); // base repo, never the fork
  });

  it('handles synchronize and reopened; ignores other actions', async () => {
    const { octokit, calls } = makeOctokit();
    const { deps, enqueued } = depsWith(octokit);

    await handlePullRequestGuardGate(deps, prPayload({ action: 'synchronize' }));
    await handlePullRequestGuardGate(deps, prPayload({ action: 'reopened' }));
    await handlePullRequestGuardGate(deps, prPayload({ action: 'closed' }));
    await handlePullRequestGuardGate(deps, prPayload({ action: 'edited' }));

    expect(enqueued).toHaveLength(2);
    expect(calls.checkStart).toHaveLength(2);
  });

  it('no-ops for unconnected, disabled, or installation-less payloads', async () => {
    const { octokit, calls } = makeOctokit();
    const { deps, enqueued } = depsWith(octokit);

    await handlePullRequestGuardGate(
      deps,
      prPayload({ repository: { full_name: 'stranger/repo', default_branch: 'main' } }),
    );
    await handlePullRequestGuardGate(deps, prPayload({ installation: undefined }));
    const link = (await store.getRepo('acme/api'))!;
    await store.linkRepo({ ...link, enabled: false });
    await handlePullRequestGuardGate(deps, prPayload());

    expect(enqueued).toHaveLength(0);
    expect(calls.checkStart).toHaveLength(0);
  });

  it('a duplicate delivery (enqueue → null) completes the just-opened Check as neutral', async () => {
    const { octokit, calls } = makeOctokit();
    const { deps } = depsWith(octokit, null);

    await handlePullRequestGuardGate(deps, prPayload());

    expect(calls.check).toHaveLength(1);
    expect(calls.check[0]).toMatchObject({
      check_run_id: 501,
      conclusion: 'neutral',
      status: 'completed',
    });
    expect(calls.check[0].output.title).toBe('Guard gate already running');
  });

  it('still enqueues (with a null checkRunId) when opening the Check fails', async () => {
    const { octokit, calls } = makeOctokit({ startCheckFails: true });
    const { deps, enqueued } = depsWith(octokit);

    await handlePullRequestGuardGate(deps, prPayload());

    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].checkRunId).toBeNull();
    expect(calls.check).toHaveLength(0);
  });
});
