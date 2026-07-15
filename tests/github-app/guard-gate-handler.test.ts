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
import { FileGateStore, GUARD_GATE_CHECK_NAME } from '../../ee/packages/github-app/src/index';
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

function makeOctokit(
  opts: {
    startCheckFails?: boolean;
    /** Pre-existing check runs on the head, as GitHub would list them. */
    existing?: Array<{ id: number; name: string; head_sha: string; status: string }>;
  } = {},
) {
  const calls = { check: [] as any[], checkStart: [] as any[], listForRef: [] as any[] };
  const checkRuns = new Map<number, any>();
  for (const run of opts.existing ?? []) checkRuns.set(run.id, run);
  let nextCheckId = 500;
  const octokit: any = {
    checks: {
      create: async (p: any) => {
        if (p.status === 'in_progress') {
          if (opts.startCheckFails) throw new Error('checks API down');
          const id = ++nextCheckId;
          calls.checkStart.push(p);
          checkRuns.set(id, { ...p, id });
          return { data: { id } };
        }
        calls.check.push(p);
        return { data: { id: ++nextCheckId } };
      },
      update: async (p: any) => {
        const created = checkRuns.get(p.check_run_id) ?? {};
        checkRuns.set(p.check_run_id, { ...created, status: p.status ?? created.status });
        calls.check.push({ ...p, head_sha: created.head_sha, name: created.name });
        return { data: { id: p.check_run_id } };
      },
      listForRef: async (p: any) => {
        calls.listForRef.push(p);
        const runs = [...checkRuns.values()].filter(
          (r) => r.head_sha === p.ref && (!p.check_name || r.name === p.check_name),
        );
        return { data: { check_runs: runs } };
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
  it('opens an in-progress guard Check and enqueues the resolved gate request', async () => {
    const { octokit, calls } = makeOctokit();
    const { deps, enqueued } = depsWith(octokit);

    await handlePullRequestGuardGate(deps, prPayload());

    expect(calls.checkStart).toHaveLength(1);
    expect(calls.checkStart[0]).toMatchObject({
      name: GUARD_GATE_CHECK_NAME,
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
    // Same head sha both times: the second delivery reuses the first delivery's
    // still-in-progress run instead of opening a shadowing second one.
    expect(calls.checkStart).toHaveLength(1);
    expect(enqueued.map((r) => r.checkRunId)).toEqual([501, 501]);
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

  it('reuses an existing queued/in-progress Check run for the head instead of creating a second one', async () => {
    // A concurrent delivery already opened run 42 for this head — a second
    // in-progress run would be NEWER, and GitHub evaluates the newest run per
    // name+sha, so it would shadow the verdict later posted to 42.
    const { octokit, calls } = makeOctokit({
      existing: [
        { id: 42, name: GUARD_GATE_CHECK_NAME, head_sha: 'headsha', status: 'in_progress' },
      ],
    });
    const { deps, enqueued } = depsWith(octokit);

    await handlePullRequestGuardGate(deps, prPayload());

    expect(calls.checkStart).toHaveLength(0);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].checkRunId).toBe(42);
  });

  it('a duplicate delivery that reused the active Check leaves it untouched (no neutral overwrite)', async () => {
    // enqueue → null means a gate job is already running — and it owns run 42.
    // Completing 42 as neutral here would destroy the verdict that job will post.
    const { octokit, calls } = makeOctokit({
      existing: [
        { id: 42, name: GUARD_GATE_CHECK_NAME, head_sha: 'headsha', status: 'in_progress' },
      ],
    });
    const { deps } = depsWith(octokit, null);

    await handlePullRequestGuardGate(deps, prPayload());

    expect(calls.checkStart).toHaveLength(0);
    expect(calls.check).toHaveLength(0);
  });

  it('a completed run for the head does not block a fresh Check (redelivery after settle)', async () => {
    const { octokit, calls } = makeOctokit({
      existing: [
        { id: 42, name: GUARD_GATE_CHECK_NAME, head_sha: 'headsha', status: 'completed' },
      ],
    });
    const { deps, enqueued } = depsWith(octokit);

    await handlePullRequestGuardGate(deps, prPayload());

    expect(calls.checkStart).toHaveLength(1);
    expect(enqueued[0].checkRunId).toBe(501);
  });

  it('a thrown enqueue completes the just-opened Check as an infra-error failure and rethrows', async () => {
    // A REJECTED enqueue (worker down, DB error) creates no job row at all, so
    // boot orphan settlement can never find it — without settling here the
    // in-progress Check would spin forever.
    const { octokit, calls } = makeOctokit();
    const deps: GuardGateHandlerDeps = {
      store,
      octokitFor: () => octokit,
      enqueueGuardGate: async () => {
        throw new Error('the background job worker is not running');
      },
    };

    await expect(handlePullRequestGuardGate(deps, prPayload())).rejects.toThrow(
      'the background job worker is not running',
    );

    expect(calls.check).toHaveLength(1);
    expect(calls.check[0]).toMatchObject({
      check_run_id: 501,
      conclusion: 'failure',
      status: 'completed',
    });
    expect(calls.check[0].output.title).toContain('Gate error');
  });

  it('a thrown enqueue never settles a REUSED Check run — the owning job posts its verdict', async () => {
    // Run 42 belongs to the gate job already running for this head; a transient
    // enqueue failure on this duplicate delivery must not complete it as a
    // failure out from under that job.
    const { octokit, calls } = makeOctokit({
      existing: [
        { id: 42, name: GUARD_GATE_CHECK_NAME, head_sha: 'headsha', status: 'in_progress' },
      ],
    });
    const deps: GuardGateHandlerDeps = {
      store,
      octokitFor: () => octokit,
      enqueueGuardGate: async () => {
        throw new Error('transient enqueue failure');
      },
    };

    await expect(handlePullRequestGuardGate(deps, prPayload())).rejects.toThrow(
      'transient enqueue failure',
    );

    expect(calls.checkStart).toHaveLength(0);
    expect(calls.check).toHaveLength(0);
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
