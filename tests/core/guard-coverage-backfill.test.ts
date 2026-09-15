/**
 * The flow backfill on Home's history read: a run stored without a flow
 * summary is derived once and the answer written back, so the read converges
 * on runs with nothing to derive, stays repairable on a failed attempt, and
 * never lets one unreadable run take the page down.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readGuardCoverageHistory } from '../../packages/core/src/commands/guard-read';
import {
  installWorkTreeGuardStore,
  resetGuardStore,
  type WorkTreeGuardStore,
} from '../helpers/work-tree-guard-store';

let store: WorkTreeGuardStore;
let repo: string;

beforeEach(() => {
  store = installWorkTreeGuardStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-backfill-'));
});

afterEach(() => {
  resetGuardStore();
  fs.rmSync(repo, { recursive: true, force: true });
});

const at = (day: number): string => `2026-09-${String(day).padStart(2, '0')}T00:00:00.000Z`;

async function storeRun(runId: string, day: number): Promise<void> {
  await store.writeGuardRunCoverage(repo, {
    runId,
    ranAt: at(day),
    commit: null,
    sections: { 'docs/a.md#a': 'succeeded' },
    flows: null,
  });
}

const storedFlows = async () =>
  Object.fromEntries((await store.readGuardRunCoverage(repo)).map((r) => [r.runId, r.flows]));

describe('readGuardCoverageHistory', () => {
  it('records a run with nothing to derive as an empty summary and never asks again', async () => {
    await storeRun('r1', 1);
    const readRun = vi.spyOn(store, 'readGuardRun');

    const first = await readGuardCoverageHistory(repo);
    expect(first.map((r) => r.flows)).toEqual([null]);
    expect(await storedFlows()).toEqual({ r1: {} });

    readRun.mockClear();
    const second = await readGuardCoverageHistory(repo);
    expect(second.map((r) => r.flows)).toEqual([null]);
    expect(readRun).not.toHaveBeenCalled();
  });

  it('leaves a run whose derivation failed null, so the next read repairs it, and still answers', async () => {
    await storeRun('r1', 1);
    vi.spyOn(store, 'readGuardRun').mockRejectedValueOnce(new Error('content object missing'));

    const history = await readGuardCoverageHistory(repo);
    expect(history.map((r) => r.flows)).toEqual([null]);
    expect(await storedFlows()).toEqual({ r1: null });

    await readGuardCoverageHistory(repo);
    expect(await storedFlows()).toEqual({ r1: {} });
  });

  it('derives every null run in one read, and none of them twice', async () => {
    for (let day = 1; day <= 6; day++) await storeRun(`r${day}`, day);
    const readRun = vi.spyOn(store, 'readGuardRun');

    await readGuardCoverageHistory(repo);
    expect(Object.values(await storedFlows())).toEqual([{}, {}, {}, {}, {}, {}]);
    expect(readRun).toHaveBeenCalledTimes(6);

    await readGuardCoverageHistory(repo);
    expect(readRun).toHaveBeenCalledTimes(6);
  });
});
