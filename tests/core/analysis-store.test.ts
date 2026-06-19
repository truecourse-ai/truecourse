import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  analysisFilePath,
  appendHistory,
  buildAnalysisFilename,
  clearLatestCache,
  deleteAnalysis,
  deleteDiff,
  deleteLatest,
  diffPath,
  historyPath,
  latestPath,
  listAnalyses,
  readAnalysis,
  readDiff,
  readHistory,
  readLatest,
  removeFromHistory,
  writeAnalysis,
  writeDiff,
  writeLatest,
} from '../../packages/core/src/lib/analysis-store';
import {
  acquireAnalyzeLock,
  AnalyzeLockError,
  atomicWriteJson,
  releaseAnalyzeLock,
} from '../../packages/core/src/lib/atomic-write';
import type {
  AnalysisSnapshot,
  DiffSnapshot,
  HistoryEntry,
  LatestSnapshot,
} from '../../packages/core/src/types/snapshot';

let repoPath: string;

beforeEach(() => {
  repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'truecourse-store-'));
  clearLatestCache();
});

afterEach(() => {
  fs.rmSync(repoPath, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSnapshot(): AnalysisSnapshot {
  const id = randomUUID();
  return {
    id,
    createdAt: '2026-04-17T14:23:45.123Z',
    branch: 'main',
    commitHash: 'abc1234',
    architecture: 'monolith',
    status: 'completed',
    metadata: { isDiffAnalysis: false },
    graph: {
      services: [],
      serviceDependencies: [],
      layers: [],
      modules: [],
      methods: [],
      moduleDeps: [],
      methodDeps: [],
      databases: [],
      databaseConnections: [],
      flows: [],
    },
    violations: {
      added: [],
      resolved: [],
      previousAnalysisId: null,
    },
    usage: [],
  };
}

function makeLatest(snapshot: AnalysisSnapshot, head: string): LatestSnapshot {
  return {
    head,
    analysis: {
      id: snapshot.id,
      createdAt: snapshot.createdAt,
      branch: snapshot.branch,
      commitHash: snapshot.commitHash,
      architecture: snapshot.architecture,
      metadata: snapshot.metadata,
      status: 'completed',
    },
    graph: snapshot.graph,
    violations: [],
  };
}

// ---------------------------------------------------------------------------
// atomic-write
// ---------------------------------------------------------------------------

describe('atomicWriteJson', () => {
  it('creates parent directories and writes valid JSON', () => {
    const target = path.join(repoPath, 'nested/dir/file.json');
    atomicWriteJson(target, { hello: 'world' });
    expect(fs.existsSync(target)).toBe(true);
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual({ hello: 'world' });
  });

  it('leaves no tmp files behind after a successful write', () => {
    const target = path.join(repoPath, 'file.json');
    atomicWriteJson(target, { a: 1 });
    const leftover = fs.readdirSync(repoPath).filter((name) => name.startsWith('file.json.tmp'));
    expect(leftover).toEqual([]);
  });

  it('overwrites an existing file atomically', () => {
    const target = path.join(repoPath, 'file.json');
    atomicWriteJson(target, { v: 1 });
    atomicWriteJson(target, { v: 2 });
    expect(JSON.parse(fs.readFileSync(target, 'utf-8'))).toEqual({ v: 2 });
  });
});

describe('analyze lock', () => {
  it('acquires and releases cleanly', async () => {
    await acquireAnalyzeLock(repoPath);
    expect(fs.existsSync(path.join(repoPath, '.truecourse/.analyze.lock'))).toBe(true);
    await releaseAnalyzeLock(repoPath);
    expect(fs.existsSync(path.join(repoPath, '.truecourse/.analyze.lock'))).toBe(false);
  });

  it('rejects a second acquire while held (file lock fail-fasts)', async () => {
    await acquireAnalyzeLock(repoPath);
    await expect(acquireAnalyzeLock(repoPath)).rejects.toThrowError(AnalyzeLockError);
    await releaseAnalyzeLock(repoPath);
  });

  it('release on a non-existent lock is a no-op', async () => {
    await expect(releaseAnalyzeLock(repoPath)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// filename builder
// ---------------------------------------------------------------------------

describe('buildAnalysisFilename', () => {
  it('is lexicographically sortable in chronological order', () => {
    const a = buildAnalysisFilename(randomUUID(), '2026-04-17T14:23:45.123Z');
    const b = buildAnalysisFilename(randomUUID(), '2026-04-17T14:30:10.456Z');
    const c = buildAnalysisFilename(randomUUID(), '2026-04-18T08:00:00.000Z');
    expect([c, a, b].sort()).toEqual([a, b, c]);
  });

  it('includes an 8-char UUID suffix to avoid same-second collisions', () => {
    const iso = '2026-04-17T14:23:45.123Z';
    const a = buildAnalysisFilename('11111111-2222-3333-4444-555555555555', iso);
    const b = buildAnalysisFilename('99999999-8888-7777-6666-555555555555', iso);
    expect(a).not.toEqual(b);
    expect(a.endsWith('_11111111.json')).toBe(true);
    expect(b.endsWith('_99999999.json')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// per-analysis snapshots
// ---------------------------------------------------------------------------

describe('analysis round-trip', () => {
  it('writes, reads back, and lists', async () => {
    const s1 = makeSnapshot();
    const s2 = { ...makeSnapshot(), createdAt: '2026-04-17T14:30:10.000Z' };
    const { filename: f1 } = await writeAnalysis(repoPath, s1);
    const { filename: f2 } = await writeAnalysis(repoPath, s2);

    expect(await readAnalysis(repoPath, f1)).toEqual(s1);
    expect(await readAnalysis(repoPath, f2)).toEqual(s2);
    expect(await listAnalyses(repoPath)).toEqual([f1, f2]);   // chronological order
    expect(fs.existsSync(analysisFilePath(repoPath, f1))).toBe(true);
  });

  it('readAnalysis returns null for missing files', async () => {
    expect(await readAnalysis(repoPath, 'does-not-exist.json')).toBeNull();
  });

  it('listAnalyses returns [] when the dir is absent', async () => {
    expect(await listAnalyses(repoPath)).toEqual([]);
  });

  it('deleteAnalysis removes the file; double-delete is safe', async () => {
    const s = makeSnapshot();
    const { filename } = await writeAnalysis(repoPath, s);
    await deleteAnalysis(repoPath, filename);
    expect(await readAnalysis(repoPath, filename)).toBeNull();
    await expect(deleteAnalysis(repoPath, filename)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// LATEST.json
// ---------------------------------------------------------------------------

describe('LATEST round-trip', () => {
  it('returns null before any write', async () => {
    expect(await readLatest(repoPath)).toBeNull();
  });

  it('round-trips', async () => {
    const s = makeSnapshot();
    const latest = makeLatest(s, 'head.json');
    await writeLatest(repoPath, latest);
    expect(await readLatest(repoPath)).toEqual(latest);
  });

  it('invalidates the in-memory cache when the file changes on disk', async () => {
    const s = makeSnapshot();
    const v1 = makeLatest(s, 'head-1.json');
    await writeLatest(repoPath, v1);
    expect(await readLatest(repoPath)).toEqual(v1);

    const v2 = makeLatest(s, 'head-2.json');
    // Bump the file mtime forward so cache invalidation triggers even
    // when the two writes land within the same OS-reported millisecond
    // (common on fast tests; Linux's ext4 has sub-ms resolution but macOS APFS reports ms).
    const future = new Date(Date.now() + 1000);
    await writeLatest(repoPath, v2);
    fs.utimesSync(latestPath(repoPath), future, future);

    expect(await readLatest(repoPath)).toEqual(v2);
  });

  it('deleteLatest clears the file and cache', async () => {
    await writeLatest(repoPath, makeLatest(makeSnapshot(), 'h.json'));
    expect(fs.existsSync(latestPath(repoPath))).toBe(true);
    await deleteLatest(repoPath);
    expect(fs.existsSync(latestPath(repoPath))).toBe(false);
    expect(await readLatest(repoPath)).toBeNull();
  });

  it('recovers from a deleted file on next read', async () => {
    await writeLatest(repoPath, makeLatest(makeSnapshot(), 'h.json'));
    await readLatest(repoPath);                     // populate cache
    fs.unlinkSync(latestPath(repoPath));       // sneak a delete past the store
    expect(await readLatest(repoPath)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// history.json
// ---------------------------------------------------------------------------

function makeHistoryEntry(id: string, createdAt: string): HistoryEntry {
  return {
    id,
    filename: `${createdAt.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z')}_${id.slice(0, 8)}.json`,
    createdAt,
    branch: 'main',
    commitHash: 'abc',
    metadata: { isDiffAnalysis: false },
    counts: {
      services: 3,
      modules: 45,
      methods: 320,
      violations: {
        new: 5,
        unchanged: 180,
        resolved: 9,
        bySeverity: { info: 0, low: 32, medium: 120, high: 40, critical: 2 },
      },
    },
    usage: { totalTokens: 120000, totalCostUsd: '0.45', durationMs: 45000, provider: 'claude-code' },
  };
}

describe('history.json round-trip', () => {
  it('starts empty and appends in order', async () => {
    expect(await readHistory(repoPath)).toEqual({ analyses: [] });

    const e1 = makeHistoryEntry(randomUUID(), '2026-04-17T14:23:45.000Z');
    const e2 = makeHistoryEntry(randomUUID(), '2026-04-17T14:30:10.000Z');
    await appendHistory(repoPath, e1);
    await appendHistory(repoPath, e2);

    expect((await readHistory(repoPath)).analyses).toEqual([e1, e2]);
    expect(fs.existsSync(historyPath(repoPath))).toBe(true);
  });

  it('removeFromHistory drops matching entries; no-op if absent', async () => {
    const e1 = makeHistoryEntry(randomUUID(), '2026-04-17T14:23:45.000Z');
    await appendHistory(repoPath, e1);
    await removeFromHistory(repoPath, 'not-there');
    expect((await readHistory(repoPath)).analyses).toEqual([e1]);
    await removeFromHistory(repoPath, e1.id);
    expect((await readHistory(repoPath)).analyses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// diff.json
// ---------------------------------------------------------------------------

function makeDiff(baseAnalysisId: string): DiffSnapshot {
  return {
    id: randomUUID(),
    baseAnalysisId,
    createdAt: '2026-04-17T14:45:10.000Z',
    branch: 'feature',
    commitHash: 'xyz',
    graph: {
      services: [],
      serviceDependencies: [],
      layers: [],
      modules: [],
      methods: [],
      moduleDeps: [],
      methodDeps: [],
      databases: [],
      databaseConnections: [],
      flows: [],
    },
    changedFiles: [{ path: 'src/foo.ts', status: 'modified' }],
    newViolations: [],
    resolvedViolations: [],
    affectedNodeIds: { services: [], layers: [], modules: [], methods: [] },
    summary: { newCount: 0, unchangedCount: 0, resolvedCount: 0 },
  };
}

describe('diff.json lifecycle', () => {
  it('reads null when absent, round-trips when written, deletes cleanly', async () => {
    expect(await readDiff(repoPath)).toBeNull();
    const d = makeDiff(randomUUID());
    await writeDiff(repoPath, d);
    expect(await readDiff(repoPath)).toEqual(d);
    expect(fs.existsSync(diffPath(repoPath))).toBe(true);
    await deleteDiff(repoPath);
    expect(await readDiff(repoPath)).toBeNull();
    await expect(deleteDiff(repoPath)).resolves.toBeUndefined();   // double-delete safe
  });
});
