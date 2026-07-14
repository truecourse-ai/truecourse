/**
 * Guard onboarding chain: a repo's FIRST successful baseline enqueues a hosted
 * guard-generate; a failed baseline never chains; a repo that already has guard
 * state (a stored generate report) is onboarded and never re-chains (issue 06
 * broadens refresh-on-merge later). Best-effort: an enqueue failure is swallowed
 * (logged), never thrown into the baseline's terminal path.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  chainGuardOnboarding,
  chainGuardBaselineRefresh,
  generateWasBlocked,
} from '../../ee/packages/server/src/jobs/guard-chain';
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

describe('chainGuardBaselineRefresh — the complement (fires when guard state EXISTS)', () => {
  it('a repo with scenarios refreshes its baseline on the settled commit', async () => {
    const enqueueGuardBaseline = vi.fn().mockResolvedValue('job_b1');
    const deps = { hasGuardState: vi.fn().mockResolvedValue(true), enqueueGuardBaseline };

    const jobId = await chainGuardBaselineRefresh(deps, payload, 'succeeded');

    expect(jobId).toBe('job_b1');
    expect(enqueueGuardBaseline).toHaveBeenCalledTimes(1);
    expect(enqueueGuardBaseline).toHaveBeenCalledWith({
      repoFullName: 'acme/api',
      installationId: 42,
      defaultBranch: 'main',
      commitSha: 'abc1234567',
      workspaceOrgId: 'org_A',
    });
  });

  it('a repo with NO guard state never refreshes (onboarding covers it instead)', async () => {
    const enqueueGuardBaseline = vi.fn();
    const deps = { hasGuardState: vi.fn().mockResolvedValue(false), enqueueGuardBaseline };

    expect(await chainGuardBaselineRefresh(deps, payload, 'succeeded')).toBeNull();
    expect(enqueueGuardBaseline).not.toHaveBeenCalled();
  });

  it('a failed settle never refreshes', async () => {
    const enqueueGuardBaseline = vi.fn();
    const hasGuardState = vi.fn();

    expect(await chainGuardBaselineRefresh({ hasGuardState, enqueueGuardBaseline }, payload, 'failed')).toBeNull();
    expect(hasGuardState).not.toHaveBeenCalled();
    expect(enqueueGuardBaseline).not.toHaveBeenCalled();
  });

  it('coalesced enqueue → null; read/enqueue failures are swallowed', async () => {
    const coalesced = { hasGuardState: vi.fn().mockResolvedValue(true), enqueueGuardBaseline: vi.fn().mockResolvedValue(null) };
    expect(await chainGuardBaselineRefresh(coalesced, payload, 'succeeded')).toBeNull();

    const boom = { hasGuardState: vi.fn().mockRejectedValue(new Error('pg down')), enqueueGuardBaseline: vi.fn() };
    await expect(chainGuardBaselineRefresh(boom, payload, 'succeeded')).resolves.toBeNull();
  });
});

describe('generateWasBlocked — the settle-chain suppression predicate', () => {
  it('is true only when the generate result carries a positive openConflicts count', () => {
    expect(generateWasBlocked({ repoFullName: 'acme/api', scenariosWritten: 0, openConflicts: 2 })).toBe(true);
    expect(generateWasBlocked({ repoFullName: 'acme/api', scenariosWritten: 0, openConflicts: 1 })).toBe(true);
  });

  it('is false for a normal generate result (openConflicts 0 or absent) and non-objects', () => {
    expect(generateWasBlocked({ repoFullName: 'acme/api', scenariosWritten: 3, openConflicts: 0 })).toBe(false);
    expect(generateWasBlocked({ repoFullName: 'acme/api', scenariosWritten: 3 })).toBe(false);
    expect(generateWasBlocked(undefined)).toBe(false);
    expect(generateWasBlocked(null)).toBe(false);
    expect(generateWasBlocked('nope')).toBe(false);
  });

  it('a blocked generate settle enqueues NO baseline run (the "Runs populated, Scenarios empty" bug)', async () => {
    // The blocked generate persisted an open-conflicts report, so hasGuardState is
    // true — the refresh chain WOULD fire. The settle gate suppresses it on the
    // result before the chain is consulted.
    const enqueueGuardBaseline = vi.fn().mockResolvedValue('job_b1');
    const hasGuardState = vi.fn().mockResolvedValue(true);
    const blockedResult = { repoFullName: 'acme/api', scenariosWritten: 0, openConflicts: 2 };

    // The wiring onGuardGenerateSettled uses: skip when blocked, else chain.
    const onGuardGenerateSettled = async (result: unknown): Promise<void> => {
      if (generateWasBlocked(result)) return;
      await chainGuardBaselineRefresh({ hasGuardState, enqueueGuardBaseline }, payload, 'succeeded');
    };

    await onGuardGenerateSettled(blockedResult);
    expect(enqueueGuardBaseline).not.toHaveBeenCalled();

    // A normal generate result DOES chain the refresh.
    await onGuardGenerateSettled({ repoFullName: 'acme/api', scenariosWritten: 3, openConflicts: 0 });
    expect(enqueueGuardBaseline).toHaveBeenCalledTimes(1);
  });
});
