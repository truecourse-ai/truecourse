import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  clearVerifyLatestCache,
  readVerifyLatest,
  readVerifyDiff,
  readVerifyHistory,
  listVerifyRuns,
  verifyLatestPath,
} from '../../packages/core/src/lib/verify-store';
import { diffDrifts, driftKey } from '../../packages/core/src/types/verify-snapshot';
import {
  verifyInProcess,
  verifyDiffInProcess,
  readVerifyState,
  verifyStatePath,
} from '../../packages/core/src/commands/spec-in-process';
import type { ContractDrift } from '@truecourse/contract-verifier';

const FIXTURE = path.resolve(__dirname, '../fixtures/sample-js-project-il');
const CONTRACTS = path.join(FIXTURE, 'reference/contracts');
const CODE = path.join(FIXTURE, 'code');

let repo: string;
beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-verify-store-'));
  clearVerifyLatestCache();
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
  clearVerifyLatestCache();
});

function drift(identity: string, obligationKey: string): ContractDrift {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'contract-drift',
    artifactRef: { type: 'Operation', identity, quoted: false },
    obligationKey,
    severity: 'high',
    filePath: '/code/x.ts',
    lineStart: 1,
    lineEnd: 1,
    message: 'm',
  };
}

// ---------------------------------------------------------------------------
// Pure diff — matched by obligation key, stable across regenerated ids
// ---------------------------------------------------------------------------

describe('diffDrifts', () => {
  it('classifies added / resolved / unchanged by obligation key', () => {
    const baseline = [drift('GET /a', 'k1'), drift('GET /b', 'k2')];
    const current = [drift('GET /b', 'k2'), drift('GET /c', 'k3')];
    const { added, resolved, unchangedCount } = diffDrifts(baseline, current);
    expect(added.map((d) => d.artifactRef.identity)).toEqual(['GET /c']);
    expect(resolved.map((d) => d.artifactRef.identity)).toEqual(['GET /a']);
    expect(unchangedCount).toBe(1);
  });

  it('is stable when drift ids regenerate (same key, different id ⇒ unchanged)', () => {
    const baseline = [drift('GET /a', 'k1')];
    const current = [drift('GET /a', 'k1')]; // different random id, same key
    expect(baseline[0].id).not.toBe(current[0].id);
    const { added, resolved, unchangedCount } = diffDrifts(baseline, current);
    expect(added).toEqual([]);
    expect(resolved).toEqual([]);
    expect(unchangedCount).toBe(1);
    expect(driftKey(baseline[0])).toBe(driftKey(current[0]));
  });

  it('dedupes added/resolved by key', () => {
    const current = [drift('GET /a', 'k1'), drift('GET /a', 'k1')];
    const { added, unchangedCount } = diffDrifts([], current);
    expect(added).toHaveLength(1);
    expect(unchangedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Persistence — runs / LATEST / history, mirroring analyze
// ---------------------------------------------------------------------------

describe('verifyInProcess persistence', () => {
  it('writes a run snapshot, LATEST, and a history entry', async () => {
    const { state } = await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    expect(state.drifts.length).toBeGreaterThan(0);

    const runs = listVerifyRuns(repo);
    expect(runs).toHaveLength(1);

    const latest = readVerifyLatest(repo);
    expect(latest).not.toBeNull();
    expect(latest!.head).toBe(runs[0]);
    expect(latest!.summary.total).toBe(state.drifts.length);

    const history = readVerifyHistory(repo);
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0].driftCount).toBe(state.drifts.length);
  });

  it('appends a second history entry on re-run', async () => {
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    clearVerifyLatestCache();
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    expect(readVerifyHistory(repo).runs).toHaveLength(2);
    expect(listVerifyRuns(repo)).toHaveLength(2);
  });

  it('readVerifyState maps the new LATEST to the legacy shape', async () => {
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    clearVerifyLatestCache();
    const s = readVerifyState(repo);
    expect(s).not.toBeNull();
    expect(Array.isArray(s!.drifts)).toBe(true);
    expect(s!.drifts.length).toBeGreaterThan(0);
  });

  it('readVerifyState falls back to the legacy verify-state.json', () => {
    const legacy = verifyStatePath(repo);
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(
      legacy,
      JSON.stringify({ verifiedAt: '2026-01-01T00:00:00Z', contractsDir: '', codeDir: '', artifactCount: 0, extractedOperationCount: 0, drifts: [], resolverErrors: [], unresolvedRefs: [] }),
    );
    const s = readVerifyState(repo);
    expect(s?.verifiedAt).toBe('2026-01-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// Diff against the committed baseline
// ---------------------------------------------------------------------------

describe('verifyDiffInProcess', () => {
  it('reports zero added/resolved when code is unchanged vs baseline', async () => {
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    clearVerifyLatestCache();
    const { diff } = await verifyDiffInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    expect(diff.summary.added).toBe(0);
    expect(diff.summary.resolved).toBe(0);
    expect(diff.summary.unchanged).toBeGreaterThan(0);
    // diff.json was written and does not disturb LATEST
    expect(readVerifyDiff(repo)).not.toBeNull();
    expect(fs.existsSync(verifyLatestPath(repo))).toBe(true);
  });

  it('throws a clear error when there is no baseline', async () => {
    await expect(
      verifyDiffInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE }),
    ).rejects.toThrow(/No verify baseline/);
  });

  it('a full run clears a prior diff', async () => {
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    clearVerifyLatestCache();
    await verifyDiffInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    expect(readVerifyDiff(repo)).not.toBeNull();
    clearVerifyLatestCache();
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    expect(readVerifyDiff(repo)).toBeNull();
  });
});
