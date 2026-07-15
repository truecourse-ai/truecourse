/**
 * Repo inheritance ripple: a successful, conflict-free `knowledge.sync` (processing)
 * job that CHANGED the workspace corpus re-scans every connected repo (force+quiet)
 * so they re-inherit the workspace layer. An unchanged corpus, open conflicts, or a
 * failed process all suppress the ripple; a single-flight loss (null enqueue)
 * coalesces onto pending-baseline; read/enqueue failures are swallowed (best-effort).
 */
import { describe, it, expect, vi } from 'vitest';
import { chainInheritanceRipple, type RippleRepo } from '../../ee/packages/server/src/jobs/knowledge-chain';
import type { SyncJobPayload } from '../../ee/packages/server/src/jobs/constants';

const payload: SyncJobPayload = { jobId: 'job_1', org: 'org_A', kind: 'confluence' };
const changed = { synced: 3, corpusChanged: true };
const unchanged = { synced: 3, corpusChanged: false };

const repos: RippleRepo[] = [
  { repoFullName: 'acme/api', installationId: 11, defaultBranch: 'main', commitSha: 'aaa' },
  { repoFullName: 'acme/web', installationId: 11, defaultBranch: 'main', commitSha: 'bbb' },
];

describe('chainInheritanceRipple', () => {
  it('a conflict-free process that changed the corpus re-scans every connected repo (force+quiet)', async () => {
    const enqueueBaseline = vi.fn().mockResolvedValue('job_b');
    const deps = {
      openConflicts: vi.fn().mockResolvedValue(0),
      listRepos: vi.fn().mockResolvedValue(repos),
      enqueueBaseline,
    };

    const n = await chainInheritanceRipple(deps, payload, 'succeeded', changed);

    expect(n).toBe(2);
    expect(deps.openConflicts).toHaveBeenCalledWith('org_A');
    expect(enqueueBaseline).toHaveBeenCalledTimes(2);
    expect(enqueueBaseline).toHaveBeenCalledWith({
      repoFullName: 'acme/api',
      installationId: 11,
      defaultBranch: 'main',
      commitSha: 'aaa',
      workspaceOrgId: 'org_A',
      force: true,
      quiet: true,
    });
  });

  it('an unchanged corpus ripples nothing (repos already carry the layer)', async () => {
    const deps = {
      openConflicts: vi.fn(),
      listRepos: vi.fn(),
      enqueueBaseline: vi.fn(),
    };

    const n = await chainInheritanceRipple(deps, payload, 'succeeded', unchanged);

    expect(n).toBe(0);
    expect(deps.openConflicts).not.toHaveBeenCalled();
    expect(deps.listRepos).not.toHaveBeenCalled();
    expect(deps.enqueueBaseline).not.toHaveBeenCalled();
  });

  it('open spec conflicts suppress the ripple (repos stay on the last clean spec)', async () => {
    const deps = {
      openConflicts: vi.fn().mockResolvedValue(2),
      listRepos: vi.fn(),
      enqueueBaseline: vi.fn(),
    };

    const n = await chainInheritanceRipple(deps, payload, 'succeeded', changed);

    expect(n).toBe(0);
    expect(deps.listRepos).not.toHaveBeenCalled();
    expect(deps.enqueueBaseline).not.toHaveBeenCalled();
  });

  it('a failed process never ripples', async () => {
    const deps = {
      openConflicts: vi.fn(),
      listRepos: vi.fn(),
      enqueueBaseline: vi.fn(),
    };

    const n = await chainInheritanceRipple(deps, payload, 'failed', changed);

    expect(n).toBe(0);
    expect(deps.openConflicts).not.toHaveBeenCalled();
    expect(deps.enqueueBaseline).not.toHaveBeenCalled();
  });

  it('a single-flight loss (null enqueue) coalesces — counted as not freshly enqueued', async () => {
    // First repo already scanning → its ripple coalesces onto pending-baseline (null);
    // the second still enqueues. Both are still attempted.
    const enqueueBaseline = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('job_b2');
    const deps = {
      openConflicts: vi.fn().mockResolvedValue(0),
      listRepos: vi.fn().mockResolvedValue(repos),
      enqueueBaseline,
    };

    const n = await chainInheritanceRipple(deps, payload, 'succeeded', changed);

    expect(n).toBe(1);
    expect(enqueueBaseline).toHaveBeenCalledTimes(2);
  });

  it('swallows read/enqueue failures — the ripple is best-effort', async () => {
    const deps = {
      openConflicts: vi.fn().mockRejectedValue(new Error('pg down')),
      listRepos: vi.fn(),
      enqueueBaseline: vi.fn(),
    };

    await expect(chainInheritanceRipple(deps, payload, 'succeeded', changed)).resolves.toBe(0);
    expect(deps.listRepos).not.toHaveBeenCalled();
  });
});
