/**
 * Guard onboarding chain: a repo's FIRST successful baseline enqueues a hosted
 * guard-generate; a failed baseline never chains; a repo that already has guard
 * state (a stored generate report) is onboarded and never re-chains (issue 06
 * broadens refresh-on-merge later). Best-effort: an enqueue failure is swallowed
 * (logged), never thrown into the baseline's terminal path.
 */
import { describe, it, expect, vi } from 'vitest';
import { chainGuardOnboarding } from '../../ee/packages/server/src/jobs/guard-chain';
import type { BaselineJobPayload } from '../../ee/packages/server/src/jobs/constants';

const payload: BaselineJobPayload = {
  jobId: 'job_1',
  workspaceOrgId: 'org_A',
  repoFullName: 'acme/api',
  installationId: 42,
  defaultBranch: 'main',
  commitSha: 'abc1234567',
};

describe('chainGuardOnboarding', () => {
  it('enqueues once, with the baseline payload projected onto the guard request', async () => {
    const enqueueGuardGenerate = vi.fn().mockResolvedValue('job_g1');
    const deps = { hasGuardState: vi.fn().mockResolvedValue(false), enqueueGuardGenerate };

    const jobId = await chainGuardOnboarding(deps, payload, 'succeeded');

    expect(jobId).toBe('job_g1');
    expect(enqueueGuardGenerate).toHaveBeenCalledTimes(1);
    expect(enqueueGuardGenerate).toHaveBeenCalledWith({
      repoFullName: 'acme/api',
      installationId: 42,
      defaultBranch: 'main',
      commitSha: 'abc1234567',
      workspaceOrgId: 'org_A',
    });
  });

  it('a failed baseline never chains (no fresh corpus to generate from)', async () => {
    const enqueueGuardGenerate = vi.fn();
    const hasGuardState = vi.fn();

    const jobId = await chainGuardOnboarding(
      { hasGuardState, enqueueGuardGenerate },
      payload,
      'failed',
    );

    expect(jobId).toBeNull();
    expect(hasGuardState).not.toHaveBeenCalled();
    expect(enqueueGuardGenerate).not.toHaveBeenCalled();
  });

  it('an already-onboarded repo (stored guard state) never re-chains', async () => {
    const enqueueGuardGenerate = vi.fn();
    const deps = { hasGuardState: vi.fn().mockResolvedValue(true), enqueueGuardGenerate };

    const jobId = await chainGuardOnboarding(deps, payload, 'succeeded');

    expect(jobId).toBeNull();
    expect(deps.hasGuardState).toHaveBeenCalledWith('acme/api');
    expect(enqueueGuardGenerate).not.toHaveBeenCalled();
  });

  it('returns null when a generate is already running (single-flight dedupe)', async () => {
    const deps = {
      hasGuardState: vi.fn().mockResolvedValue(false),
      enqueueGuardGenerate: vi.fn().mockResolvedValue(null),
    };
    expect(await chainGuardOnboarding(deps, payload, 'succeeded')).toBeNull();
  });

  it('swallows enqueue/read failures — the chain is best-effort', async () => {
    const deps = {
      hasGuardState: vi.fn().mockRejectedValue(new Error('pg down')),
      enqueueGuardGenerate: vi.fn(),
    };
    await expect(chainGuardOnboarding(deps, payload, 'succeeded')).resolves.toBeNull();
  });
});
