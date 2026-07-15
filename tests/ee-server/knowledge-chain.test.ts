/**
 * Workspace guard chain: a successful, conflict-free `knowledge.sync` (processing)
 * job chains a `knowledge.guard` scenario generate; open spec conflicts suppress
 * the chain (generation stays blocked); a failed process never chains. Best-effort:
 * a coalesced enqueue (org single-flight — the ActiveJobExistsError the enqueue
 * swallows to null) and read/enqueue failures both leave the completed process's
 * terminal path untouched.
 */
import { describe, it, expect, vi } from 'vitest';
import { chainWorkspaceGuard } from '../../ee/packages/server/src/jobs/knowledge-chain';
import type { SyncJobPayload } from '../../ee/packages/server/src/jobs/constants';

const payload: SyncJobPayload = { jobId: 'job_1', org: 'org_A', kind: 'confluence' };

describe('chainWorkspaceGuard', () => {
  it('a conflict-free process success enqueues the workspace scenario generate once', async () => {
    const enqueueWorkspaceGuard = vi.fn().mockResolvedValue('job_g1');
    const deps = { openConflicts: vi.fn().mockResolvedValue(0), enqueueWorkspaceGuard };

    const jobId = await chainWorkspaceGuard(deps, payload, 'succeeded');

    expect(jobId).toBe('job_g1');
    expect(deps.openConflicts).toHaveBeenCalledWith('org_A');
    expect(enqueueWorkspaceGuard).toHaveBeenCalledTimes(1);
    expect(enqueueWorkspaceGuard).toHaveBeenCalledWith('org_A');
  });

  it('open spec conflicts suppress the chain (generation stays blocked)', async () => {
    const enqueueWorkspaceGuard = vi.fn();
    const deps = { openConflicts: vi.fn().mockResolvedValue(2), enqueueWorkspaceGuard };

    const jobId = await chainWorkspaceGuard(deps, payload, 'succeeded');

    expect(jobId).toBeNull();
    expect(enqueueWorkspaceGuard).not.toHaveBeenCalled();
  });

  it('a failed process never chains (no fresh corpus to generate from)', async () => {
    const openConflicts = vi.fn();
    const enqueueWorkspaceGuard = vi.fn();

    const jobId = await chainWorkspaceGuard({ openConflicts, enqueueWorkspaceGuard }, payload, 'failed');

    expect(jobId).toBeNull();
    expect(openConflicts).not.toHaveBeenCalled();
    expect(enqueueWorkspaceGuard).not.toHaveBeenCalled();
  });

  it('returns null when a generate is already running (ActiveJobExistsError swallowed to null)', async () => {
    const deps = {
      openConflicts: vi.fn().mockResolvedValue(0),
      enqueueWorkspaceGuard: vi.fn().mockResolvedValue(null),
    };
    expect(await chainWorkspaceGuard(deps, payload, 'succeeded')).toBeNull();
  });

  it('swallows read/enqueue failures — the chain is best-effort', async () => {
    const boom = {
      openConflicts: vi.fn().mockRejectedValue(new Error('pg down')),
      enqueueWorkspaceGuard: vi.fn(),
    };
    await expect(chainWorkspaceGuard(boom, payload, 'succeeded')).resolves.toBeNull();
    expect(boom.enqueueWorkspaceGuard).not.toHaveBeenCalled();
  });
});
