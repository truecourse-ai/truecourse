/**
 * The gate-heads lookup factory — the EE half of the PR run timeline. It answers
 * `readGuardHistoryForPr`'s seam from the gate-run records: the PR's distinct
 * head SHAs, newest-first (listRuns order), other PRs filtered out, and a store
 * failure resolving to no heads (best-effort — the timeline is a read surface,
 * never allowed to fail the view).
 */
import { describe, it, expect } from 'vitest';
import type { GateStore, GateRunRecord } from '../../ee/packages/github-app/src/store/types';
import { createGuardGateHeadsLookup } from '../../ee/packages/github-app/src/guard-gate-heads';

const rec = (prNumber: number, headSha: string, createdAt: string): GateRunRecord => ({
  id: `${headSha}-${createdAt}`,
  repoFullName: 'acme/api',
  prNumber,
  headSha,
  baseSha: 'base00000000',
  conclusion: 'success',
  addedCount: 0,
  resolvedCount: 0,
  createdAt,
});

const storeWith = (runs: GateRunRecord[]): GateStore =>
  ({ listRuns: async () => runs }) as unknown as GateStore;

describe('createGuardGateHeadsLookup', () => {
  it("returns the PR's distinct head SHAs newest-first, other PRs filtered out", async () => {
    // listRuns answers newest-first; head2 gated twice (re-run) → one entry.
    const lookup = createGuardGateHeadsLookup(
      storeWith([
        rec(22, 'head2222', '2026-07-10T02:00:00.000Z'),
        rec(22, 'head2222', '2026-07-10T01:00:00.000Z'),
        rec(7, 'otherpr1', '2026-07-09T12:00:00.000Z'),
        rec(22, 'head1111', '2026-07-09T00:00:00.000Z'),
      ]),
    );
    expect(await lookup('acme/api', 22)).toEqual(['head2222', 'head1111']);
  });

  it('a store failure resolves to no heads (best-effort, never throws)', async () => {
    const lookup = createGuardGateHeadsLookup(
      ({ listRuns: async () => { throw new Error('pg down'); } }) as unknown as GateStore,
    );
    expect(await lookup('acme/api', 22)).toEqual([]);
  });
});
