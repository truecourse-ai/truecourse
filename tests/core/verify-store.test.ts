import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  clearVerifyLatestCache,
  readVerifyLatest,
  readVerifyDiff,
  readVerifyHistory,
  listVerifyRuns,
  verifyLatestPath,
  writeVerifyRun,
  writeVerifyLatest,
  appendVerifyHistory,
  deleteVerifyRun,
} from '../../packages/core/src/lib/verify-store';
import type { VerifyRunSnapshot } from '../../packages/core/src/types/verify-snapshot';
import { diffDrifts, driftKey } from '../../packages/core/src/types/verify-snapshot';
import {
  verifyInProcess,
  verifyDiffInProcess,
  readVerifyState,
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

function gitInit(dir: string): void {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.co', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
  execSync('git commit -q --allow-empty -m init', { cwd: dir });
}

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

  it('does NOT fall back to a legacy verify-state.json — the new store is the only source', () => {
    const legacy = path.join(repo, '.truecourse', '.cache', 'verifier', 'verify-state.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(
      legacy,
      JSON.stringify({ verifiedAt: '2026-01-01T00:00:00Z', contractsDir: '', codeDir: '', artifactCount: 0, extractedOperationCount: 0, drifts: [], resolverErrors: [], unresolvedRefs: [] }),
    );
    // No verifier/LATEST.json yet ⇒ null, despite the legacy file existing.
    expect(readVerifyState(repo)).toBeNull();
  });

  it('a verify run deletes any stale legacy verify-state.json', async () => {
    const legacy = path.join(repo, '.truecourse', '.cache', 'verifier', 'verify-state.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(legacy, '{}');
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    expect(fs.existsSync(legacy)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Diff against the committed baseline
// ---------------------------------------------------------------------------

describe('verifyDiffInProcess', () => {
  // Diff mirrors `analyze --diff`: it requires a git repo (working tree vs
  // committed baseline). Each test makes the tmp repo a real git repo.
  beforeEach(() => gitInit(repo));

  it('reports zero added/resolved when code is unchanged vs baseline + carries changedFiles', async () => {
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE, skipStash: true });
    clearVerifyLatestCache();
    const { diff } = await verifyDiffInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    expect(diff.summary.added).toBe(0);
    expect(diff.summary.resolved).toBe(0);
    expect(diff.summary.unchanged).toBeGreaterThan(0);
    expect(Array.isArray(diff.changedFiles)).toBe(true);
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
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE, skipStash: true });
    clearVerifyLatestCache();
    await verifyDiffInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    expect(readVerifyDiff(repo)).not.toBeNull();
    clearVerifyLatestCache();
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE, skipStash: true });
    expect(readVerifyDiff(repo)).toBeNull();
  });
});

describe('verify diff requires git', () => {
  it('throws outside a git repo (non-git tmp dir)', async () => {
    // `repo` here is a plain tmp dir (no git init).
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE, skipStash: true });
    clearVerifyLatestCache();
    await expect(
      verifyDiffInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE }),
    ).rejects.toThrow(/requires a git repository/);
  });
});

describe('full verify stashes the dirty tree (baseline = committed state)', () => {
  it('restores working-tree changes after the run', async () => {
    gitInit(repo);
    const tracked = path.join(repo, 'note.txt');
    fs.writeFileSync(tracked, 'committed\n');
    execSync('git add note.txt', { cwd: repo });
    execSync('git commit -q -m add-note', { cwd: repo });
    fs.writeFileSync(tracked, 'uncommitted edit\n'); // dirty

    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE }); // skipStash defaults false

    // The dirty edit was stashed for the run, then popped back.
    expect(fs.readFileSync(tracked, 'utf-8')).toBe('uncommitted edit\n');
  });
});

// ---------------------------------------------------------------------------
// deleteVerifyRun — keeps LATEST consistent with history
// ---------------------------------------------------------------------------

function snapshot(id: string, verifiedAt: string, drifts: ContractDrift[]): VerifyRunSnapshot {
  return {
    id,
    verifiedAt,
    branch: 'main',
    commitHash: null,
    contractsDir: '.truecourse/contracts',
    codeDir: '.',
    artifactCount: 5,
    extractedOperationCount: 2,
    drifts,
    resolverErrors: [],
    unresolvedRefs: [],
  };
}

/** Record a run as a snapshot + history entry, and point LATEST at it. */
function recordRun(repoPath: string, snap: VerifyRunSnapshot): void {
  const { filename } = writeVerifyRun(repoPath, snap);
  appendVerifyHistory(repoPath, {
    id: snap.id,
    filename,
    verifiedAt: snap.verifiedAt,
    branch: snap.branch,
    commitHash: snap.commitHash,
    artifactCount: snap.artifactCount,
    driftCount: snap.drifts.length,
    bySeverity: { info: 0, low: 0, medium: 0, high: snap.drifts.length, critical: 0 },
  });
  writeVerifyLatest(repoPath, {
    head: filename,
    run: {
      id: snap.id,
      verifiedAt: snap.verifiedAt,
      branch: snap.branch,
      commitHash: snap.commitHash,
      contractsDir: snap.contractsDir,
      codeDir: snap.codeDir,
    },
    artifactCount: snap.artifactCount,
    extractedOperationCount: snap.extractedOperationCount,
    drifts: snap.drifts,
    resolverErrors: [],
    unresolvedRefs: [],
    summary: { total: snap.drifts.length, bySeverity: { info: 0, low: 0, medium: 0, high: snap.drifts.length, critical: 0 } },
  });
}

describe('deleteVerifyRun', () => {
  it('rebuilds LATEST from the newest remaining run when the head is deleted', () => {
    recordRun(repo, snapshot('run-old', '2026-01-01T00:00:00.000Z', [drift('GET /a', 'k1')]));
    recordRun(repo, snapshot('run-new', '2026-01-02T00:00:00.000Z', [drift('GET /b', 'k2')]));

    // LATEST currently points at run-new.
    expect(readVerifyLatest(repo)?.run.id).toBe('run-new');

    expect(deleteVerifyRun(repo, 'run-new')).toBe(true);

    // LATEST re-derived from run-old; history has one entry left.
    expect(readVerifyLatest(repo)?.run.id).toBe('run-old');
    expect(readVerifyHistory(repo).runs.map((r) => r.id)).toEqual(['run-old']);
    expect(readVerifyState(repo)?.drifts.map((d) => d.obligationKey)).toEqual(['k1']);
  });

  it('clears LATEST entirely when the last run is deleted', () => {
    recordRun(repo, snapshot('run-only', '2026-01-01T00:00:00.000Z', [drift('GET /a', 'k1')]));
    expect(deleteVerifyRun(repo, 'run-only')).toBe(true);

    expect(readVerifyLatest(repo)).toBeNull();
    expect(readVerifyState(repo)).toBeNull();
    expect(readVerifyHistory(repo).runs).toHaveLength(0);
  });

  it('leaves LATEST untouched when a non-head run is deleted', () => {
    recordRun(repo, snapshot('run-old', '2026-01-01T00:00:00.000Z', [drift('GET /a', 'k1')]));
    recordRun(repo, snapshot('run-new', '2026-01-02T00:00:00.000Z', [drift('GET /b', 'k2')]));

    expect(deleteVerifyRun(repo, 'run-old')).toBe(true);
    expect(readVerifyLatest(repo)?.run.id).toBe('run-new');
  });

  it('returns false for an unknown run id', () => {
    expect(deleteVerifyRun(repo, 'nope')).toBe(false);
  });
});
