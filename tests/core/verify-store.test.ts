import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import {
  clearVerifyLatestCache,
  readVerifyLatest,
  readVerifyDiff,
  writeVerifyDiff,
  deleteVerifyDiff,
  readVerifyHistory,
  listVerifyRuns,
  verifyLatestPath,
  writeVerifyRun,
  writeVerifyLatest,
  appendVerifyHistory,
  deleteVerifyRun,
} from '../../packages/core/src/lib/verify-store';
import type { VerifyRunSnapshot, VerifyDiff } from '../../packages/core/src/types/verify-snapshot';
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

function makeDiff(added: ContractDrift[], resolved: ContractDrift[]): VerifyDiff {
  return {
    id: 'd1',
    baseRunId: 'base',
    verifiedAt: '2026-01-01T00:00:00.000Z',
    branch: 'feature',
    commitHash: 'abc123',
    added,
    resolved,
    unchangedCount: 0,
    changedFiles: [{ path: 'src/a.ts', status: 'modified' }],
    summary: { added: added.length, resolved: resolved.length, unchanged: 0 },
  };
}

// ---------------------------------------------------------------------------
// Scoped diff slots — EE keys a diff per PR (`pr-<N>`) alongside the default
// working-tree diff; the file store mirrors this with `diff-<scope>.json`.
// ---------------------------------------------------------------------------

describe('verify diff scope (per-PR slot)', () => {
  it('round-trips a scoped diff independently of the default slot', async () => {
    const prDiff = makeDiff([drift('GET /a', 'k1')], []);
    await writeVerifyDiff(repo, prDiff, 'pr-7');

    expect(await readVerifyDiff(repo, 'pr-7')).toEqual(prDiff);
    // A different scope and the default (unscoped) slot are untouched.
    expect(await readVerifyDiff(repo, 'pr-8')).toBeNull();
    expect(await readVerifyDiff(repo)).toBeNull();
  });

  it('keeps the default diff and a PR diff in separate slots', async () => {
    const mainDiff = makeDiff([], [drift('GET /b', 'k2')]);
    const prDiff = makeDiff([drift('GET /c', 'k3')], []);
    await writeVerifyDiff(repo, mainDiff);
    await writeVerifyDiff(repo, prDiff, 'pr-12');

    expect(await readVerifyDiff(repo)).toEqual(mainDiff);
    expect(await readVerifyDiff(repo, 'pr-12')).toEqual(prDiff);
  });

  it('deleteVerifyDiff(scope) removes only that PR slot', async () => {
    await writeVerifyDiff(repo, makeDiff([], []), 'pr-7');
    await writeVerifyDiff(repo, makeDiff([], []), 'pr-8');
    await deleteVerifyDiff(repo, 'pr-7');

    expect(await readVerifyDiff(repo, 'pr-7')).toBeNull();
    expect(await readVerifyDiff(repo, 'pr-8')).not.toBeNull();
  });
});

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

  it('counts unchanged by UNIQUE key — two current drifts on one baseline key count once', () => {
    // Two current drifts collapse to the same key as one baseline drift.
    // unchangedCount must be key-deduped (1), consistent with added/resolved
    // — not 2 (the raw-current-drift count that caused the "44 vs 43" bug).
    const baseline = [drift('GET /a', 'k1')];
    const current = [drift('GET /a', 'k1'), drift('GET /a', 'k1')];
    const { added, resolved, unchangedCount } = diffDrifts(baseline, current);
    expect(added).toEqual([]);
    expect(resolved).toEqual([]);
    expect(unchangedCount).toBe(1);
  });

  it('occurrence-level: same artifact+obligation, different enclosingSymbol ⇒ distinct keys', () => {
    // A per-query drift attributed to `ordersRepo.list` and a second one to
    // `ordersRepo.recentlyTouched` share artifactRef + obligationKey but sit
    // at different code sites. They must NOT collapse: the head-only one is
    // `added`, and the matching-symbol one stays `unchanged`.
    const listDrift = (): ContractDrift => ({
      ...drift('QueryRule', 'query.predicate.forbidden-present.deletedAt.is-null'),
      enclosingSymbol: 'ordersRepo.list',
      occurrenceIndex: 0,
    });
    const recentDrift = (): ContractDrift => ({
      ...drift('QueryRule', 'query.predicate.forbidden-present.deletedAt.is-null'),
      enclosingSymbol: 'ordersRepo.recentlyTouched',
      occurrenceIndex: 0,
    });

    // Distinct driftKeys despite identical artifact + obligation.
    expect(driftKey(listDrift())).not.toBe(driftKey(recentDrift()));

    // Baseline has only `list`; current adds `recentlyTouched` at a new site.
    const baseline = [listDrift()];
    const current = [listDrift(), recentDrift()];
    const { added, resolved, unchangedCount } = diffDrifts(baseline, current);
    expect(added.map((d) => d.enclosingSymbol)).toEqual(['ordersRepo.recentlyTouched']);
    expect(resolved).toEqual([]);
    expect(unchangedCount).toBe(1); // the `list` site is unchanged
  });

  it('occurrence-level: same symbol + index ⇒ same key ⇒ unchanged', () => {
    const make = (): ContractDrift => ({
      ...drift('QueryRule', 'query.predicate.forbidden-present.deletedAt.is-null'),
      enclosingSymbol: 'ordersRepo.list',
      occurrenceIndex: 0,
    });
    expect(driftKey(make())).toBe(driftKey(make()));
    const { added, resolved, unchangedCount } = diffDrifts([make()], [make()]);
    expect(added).toEqual([]);
    expect(resolved).toEqual([]);
    expect(unchangedCount).toBe(1);
  });

  it('occurrence-level: same symbol, different occurrenceIndex ⇒ distinct keys', () => {
    // Two violations of the SAME obligation INSIDE THE SAME enclosing symbol
    // (e.g. two offending `.filter()` calls in one repo method). The symbol
    // alone can't separate them; `occurrenceIndex` does. Adding a second
    // occurrence in the same symbol must show up as `added`, not collapse.
    const occ = (occurrenceIndex: number): ContractDrift => ({
      ...drift('QueryRule', 'query.predicate.forbidden-present.deletedAt.is-null'),
      enclosingSymbol: 'ordersRepo.list',
      occurrenceIndex,
    });
    expect(driftKey(occ(0))).not.toBe(driftKey(occ(1)));

    const baseline = [occ(0)];
    const current = [occ(0), occ(1)];
    const { added, resolved, unchangedCount } = diffDrifts(baseline, current);
    expect(added.map((d) => d.occurrenceIndex)).toEqual([1]);
    expect(resolved).toEqual([]);
    expect(unchangedCount).toBe(1); // the #0 occurrence is unchanged
  });

  it('occurrence-level: no enclosingSymbol ⇒ obligation-level key (index ignored)', () => {
    // A site-bearing kind that resolved to no enclosing function (top-level
    // forbidden import) stays obligation-level: the key omits the `@ …`
    // anchor entirely, so a stray occurrenceIndex never leaks into it.
    const bare = (): ContractDrift =>
      drift('QueryRule', 'query.predicate.forbidden-present.deletedAt.is-null');
    // The `drift()` helper builds `Operation:<identity> / <obligationKey>`;
    // with no enclosingSymbol the key carries no site anchor.
    expect(driftKey(bare())).toBe(
      'Operation:QueryRule / query.predicate.forbidden-present.deletedAt.is-null',
    );
    expect(driftKey(bare())).not.toContain('@');
  });
});

// ---------------------------------------------------------------------------
// Persistence — runs / LATEST / history, mirroring analyze
// ---------------------------------------------------------------------------

describe('verifyInProcess persistence', () => {
  it('writes a run snapshot, LATEST, and a history entry', async () => {
    const { state } = await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    expect(state.drifts.length).toBeGreaterThan(0);

    const runs = await listVerifyRuns(repo);
    expect(runs).toHaveLength(1);

    const latest = await readVerifyLatest(repo);
    expect(latest).not.toBeNull();
    expect(latest!.head).toBe(runs[0]);
    expect(latest!.summary.total).toBe(state.drifts.length);

    const history = await readVerifyHistory(repo);
    expect(history.runs).toHaveLength(1);
    expect(history.runs[0].driftCount).toBe(state.drifts.length);
  });

  it('appends a second history entry on re-run', async () => {
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    clearVerifyLatestCache();
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    expect((await readVerifyHistory(repo)).runs).toHaveLength(2);
    expect(await listVerifyRuns(repo)).toHaveLength(2);
  });

  it('readVerifyState maps the new LATEST to the legacy shape', async () => {
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE });
    clearVerifyLatestCache();
    const s = await readVerifyState(repo);
    expect(s).not.toBeNull();
    expect(Array.isArray(s!.drifts)).toBe(true);
    expect(s!.drifts.length).toBeGreaterThan(0);
  });

  it('does NOT fall back to a legacy verify-state.json — the new store is the only source', async () => {
    const legacy = path.join(repo, '.truecourse', '.cache', 'verifier', 'verify-state.json');
    fs.mkdirSync(path.dirname(legacy), { recursive: true });
    fs.writeFileSync(
      legacy,
      JSON.stringify({ verifiedAt: '2026-01-01T00:00:00Z', contractsDir: '', codeDir: '', artifactCount: 0, extractedOperationCount: 0, drifts: [], resolverErrors: [], unresolvedRefs: [] }),
    );
    // No verifier/LATEST.json yet ⇒ null, despite the legacy file existing.
    expect(await readVerifyState(repo)).toBeNull();
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
    expect(await readVerifyDiff(repo)).not.toBeNull();
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
    expect(await readVerifyDiff(repo)).not.toBeNull();
    clearVerifyLatestCache();
    await verifyInProcess(repo, { contractsDir: CONTRACTS, codeDir: CODE, skipStash: true });
    expect(await readVerifyDiff(repo)).toBeNull();
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
async function recordRun(repoPath: string, snap: VerifyRunSnapshot): Promise<void> {
  const { filename } = await writeVerifyRun(repoPath, snap);
  await appendVerifyHistory(repoPath, {
    id: snap.id,
    filename,
    verifiedAt: snap.verifiedAt,
    branch: snap.branch,
    commitHash: snap.commitHash,
    artifactCount: snap.artifactCount,
    driftCount: snap.drifts.length,
    bySeverity: { info: 0, low: 0, medium: 0, high: snap.drifts.length, critical: 0 },
  });
  await writeVerifyLatest(repoPath, {
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
  it('rebuilds LATEST from the newest remaining run when the head is deleted', async () => {
    await recordRun(repo, snapshot('run-old', '2026-01-01T00:00:00.000Z', [drift('GET /a', 'k1')]));
    await recordRun(repo, snapshot('run-new', '2026-01-02T00:00:00.000Z', [drift('GET /b', 'k2')]));

    // LATEST currently points at run-new.
    expect((await readVerifyLatest(repo))?.run.id).toBe('run-new');

    expect(await deleteVerifyRun(repo, 'run-new')).toBe(true);

    // LATEST re-derived from run-old; history has one entry left.
    expect((await readVerifyLatest(repo))?.run.id).toBe('run-old');
    expect((await readVerifyHistory(repo)).runs.map((r) => r.id)).toEqual(['run-old']);
    expect((await readVerifyState(repo))?.drifts.map((d) => d.obligationKey)).toEqual(['k1']);
  });

  it('clears LATEST entirely when the last run is deleted', async () => {
    await recordRun(repo, snapshot('run-only', '2026-01-01T00:00:00.000Z', [drift('GET /a', 'k1')]));
    expect(await deleteVerifyRun(repo, 'run-only')).toBe(true);

    expect(await readVerifyLatest(repo)).toBeNull();
    expect(await readVerifyState(repo)).toBeNull();
    expect((await readVerifyHistory(repo)).runs).toHaveLength(0);
  });

  it('leaves LATEST untouched when a non-head run is deleted', async () => {
    await recordRun(repo, snapshot('run-old', '2026-01-01T00:00:00.000Z', [drift('GET /a', 'k1')]));
    await recordRun(repo, snapshot('run-new', '2026-01-02T00:00:00.000Z', [drift('GET /b', 'k2')]));

    expect(await deleteVerifyRun(repo, 'run-old')).toBe(true);
    expect((await readVerifyLatest(repo))?.run.id).toBe('run-new');
  });

  it('returns false for an unknown run id', async () => {
    expect(await deleteVerifyRun(repo, 'nope')).toBe(false);
  });
});
