import { describe, it, expect } from 'vitest';
import { runBaseline, type BaselineDeps } from '../../ee/packages/github-app/src/baseline';
import type { GateStore, BaselineRecord } from '../../ee/packages/github-app/src/store/types';

/**
 * The `force` skip-bypass on `runBaseline`. Both cases stop at the FIRST post-skip
 * step — the injected `onPhase('clone')` — so no git/network/core is needed: the
 * tripwire tells us whether the run skipped (returned before cloning) or proceeded
 * (reached the clone phase). That isolates exactly the branch the chain depends on.
 */

const REQ = { repoFullName: 'o/r', installationId: 1, defaultBranch: 'main', commitSha: 'C' };

function storeWithBaseline(baseline: BaselineRecord): GateStore {
  // runBaseline only touches getBaseline before the skip/clone in these cases.
  return { getBaseline: async () => baseline } as unknown as GateStore;
}

const baseDeps = (
  store: GateStore,
  onPhase: BaselineDeps['onPhase'],
): BaselineDeps => ({ store, auth: {} as BaselineDeps['auth'], onPhase });

describe('runBaseline — force skip-bypass', () => {
  it('skips (returns before cloning) when the commit is already baselined and force is unset', async () => {
    const baseline: BaselineRecord = {
      repoFullName: 'o/r',
      commitSha: 'C',
      drifts: [], // non-null ⇒ a real (verified) baseline ⇒ hasContracts true
      capturedAt: '2026-01-01T00:00:00.000Z',
    };
    let cloneReached = false;
    const result = await runBaseline(
      baseDeps(storeWithBaseline(baseline), (p) => {
        if (p === 'clone') cloneReached = true;
      }),
      REQ, // no force
    );

    expect(cloneReached).toBe(false); // returned before any clone
    expect(result).toEqual({ openConflicts: 0, hasContracts: true });
  });

  it('force re-runs even when the same commit is already baselined (bypasses the skip)', async () => {
    const neutral: BaselineRecord = {
      repoFullName: 'o/r',
      commitSha: 'C',
      drifts: null, // the neutral baseline connect saved when conflicts blocked contracts
      capturedAt: '2026-01-01T00:00:00.000Z',
    };
    const sentinel = new Error('CLONE_PHASE_REACHED');
    await expect(
      runBaseline(
        baseDeps(storeWithBaseline(neutral), (p) => {
          if (p === 'clone') throw sentinel;
        }),
        { ...REQ, force: true },
      ),
    ).rejects.toThrow('CLONE_PHASE_REACHED'); // proceeded past the skip to the clone phase
  });
});
