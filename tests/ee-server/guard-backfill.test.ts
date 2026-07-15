/**
 * Deploy-time guard backfill (issue 06): the per-repo generate-vs-baseline
 * routing, the run-once marker (exactly-once across deploys), the never-scanned
 * skip, and the never-throws contract. Pure orchestration over injected deps.
 */
import { describe, it, expect, vi } from 'vitest';
import type { OperatorRepoRef } from '@truecourse/ee-github-app';
import {
  runGuardBackfill,
  type GuardBackfillDeps,
} from '../../ee/packages/server/src/jobs/guard-backfill';

function repo(name: string, over: Partial<OperatorRepoRef> = {}): OperatorRepoRef {
  return { repoFullName: name, installationId: 42, defaultBranch: 'main', workspaceOrgId: 'org_A', ...over };
}

/** A fake backfill environment: in-memory state per repo + a persisted marker set. */
function harness(
  repos: OperatorRepoRef[],
  state: Record<string, { commit?: string; scenarios?: boolean; baseline?: boolean }>,
  markedInitially: string[] = [],
) {
  const marked = new Set(markedInitially);
  const generate = vi.fn(async () => 'g');
  const baseline = vi.fn(async () => 'b');
  const deps: GuardBackfillDeps = {
    listRepos: async () => repos,
    baselineCommit: async (r) => state[r]?.commit ?? null,
    hasScenarios: async (r) => state[r]?.scenarios ?? false,
    hasBaseline: async (r) => state[r]?.baseline ?? false,
    isBackfilled: async (r) => marked.has(r),
    markBackfilled: async (r) => void marked.add(r),
    enqueueGuardGenerate: generate,
    enqueueGuardBaseline: baseline,
  };
  return { deps, generate, baseline, marked };
}

describe('runGuardBackfill — routing', () => {
  it('no scenarios → generate; scenarios but no baseline → baseline; both present → skip', async () => {
    const repos = [repo('acme/gen'), repo('acme/base'), repo('acme/done')];
    const { deps, generate, baseline, marked } = harness(repos, {
      'acme/gen': { commit: 'c1' },
      'acme/base': { commit: 'c2', scenarios: true },
      'acme/done': { commit: 'c3', scenarios: true, baseline: true },
    });

    const summary = await runGuardBackfill(deps);

    expect(summary).toEqual({ generateEnqueued: 1, baselineEnqueued: 1, skipped: 1 });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: 'acme/gen', commitSha: 'c1', workspaceOrgId: 'org_A' }),
    );
    expect(baseline).toHaveBeenCalledWith(
      expect.objectContaining({ repoFullName: 'acme/base', commitSha: 'c2' }),
    );
    // Every processed repo is marked.
    expect([...marked].sort()).toEqual(['acme/base', 'acme/done', 'acme/gen']);
  });

  it('stamps each enqueue with the repo OWN workspace (per-tenant jobs-UI attribution)', async () => {
    const repos = [repo('acme/api', { workspaceOrgId: 'org_A' }), repo('zeta/web', { workspaceOrgId: 'org_B' })];
    const { deps, generate } = harness(repos, {
      'acme/api': { commit: 'c1' },
      'zeta/web': { commit: 'c2' },
    });

    await runGuardBackfill(deps);

    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ repoFullName: 'acme/api', workspaceOrgId: 'org_A' }));
    expect(generate).toHaveBeenCalledWith(expect.objectContaining({ repoFullName: 'zeta/web', workspaceOrgId: 'org_B' }));
  });
});

describe('runGuardBackfill — exactly-once', () => {
  it('a second run (marker persisted) enqueues nothing', async () => {
    const repos = [repo('acme/gen')];
    const state = { 'acme/gen': { commit: 'c1' } };
    const { deps, generate, marked } = harness(repos, state);

    await runGuardBackfill(deps);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(marked.has('acme/gen')).toBe(true);

    // Re-deploy: same deps (marker survives) → skip entirely, even though the repo
    // still has no scenarios (a repo with no spec docs never gains guard state).
    const second = await runGuardBackfill(deps);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ generateEnqueued: 0, baselineEnqueued: 0, skipped: 1 });
  });

  it('a coalesced enqueue (null return) is not counted, but the repo is still marked', async () => {
    const repos = [repo('acme/gen'), repo('acme/base')];
    const { deps, marked } = harness(repos, {
      'acme/gen': { commit: 'c1' },
      'acme/base': { commit: 'c2', scenarios: true },
    });
    // Both enqueues coalesce onto in-flight work → null, so neither is counted.
    deps.enqueueGuardGenerate = vi.fn(async () => null);
    deps.enqueueGuardBaseline = vi.fn(async () => null);

    const summary = await runGuardBackfill(deps);

    expect(summary).toEqual({ generateEnqueued: 0, baselineEnqueued: 0, skipped: 0 });
    // The repos are still marked (the enqueue was attempted — a re-deploy must not retry).
    expect([...marked].sort()).toEqual(['acme/base', 'acme/gen']);
  });

  it('a never-scanned repo (no baseline commit) is skipped WITHOUT marking', async () => {
    const repos = [repo('acme/fresh')];
    const { deps, generate, baseline, marked } = harness(repos, { 'acme/fresh': {} });

    const summary = await runGuardBackfill(deps);

    expect(generate).not.toHaveBeenCalled();
    expect(baseline).not.toHaveBeenCalled();
    expect(summary).toEqual({ generateEnqueued: 0, baselineEnqueued: 0, skipped: 1 });
    // Left unmarked so a later deploy (post-scan) can still back it up.
    expect(marked.has('acme/fresh')).toBe(false);
  });
});

describe('runGuardBackfill — never throws', () => {
  it('an enqueue failure for one repo does not stop the rest', async () => {
    const repos = [repo('acme/bad'), repo('acme/good')];
    const { deps, baseline } = harness(repos, {
      'acme/bad': { commit: 'c1' },
      'acme/good': { commit: 'c2', scenarios: true },
    });
    deps.enqueueGuardGenerate = vi.fn(async () => {
      throw new Error('queue down');
    });

    const summary = await runGuardBackfill(deps);

    // acme/bad threw (not counted), acme/good still enqueued its baseline.
    expect(summary.baselineEnqueued).toBe(1);
    expect(baseline).toHaveBeenCalledWith(expect.objectContaining({ repoFullName: 'acme/good' }));
  });

  it('a failure enumerating repos returns a zero summary rather than throwing', async () => {
    const deps = {
      listRepos: async () => {
        throw new Error('db down');
      },
    } as unknown as GuardBackfillDeps;

    await expect(runGuardBackfill(deps)).resolves.toEqual({
      generateEnqueued: 0,
      baselineEnqueued: 0,
      skipped: 0,
    });
  });
});
