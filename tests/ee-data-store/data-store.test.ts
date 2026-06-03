import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import {
  PgBlobAnalysisStore,
  PgBlobVerifyStore,
} from '../../ee/packages/data-store/src/index';
import type {
  AnalysisSnapshot,
  DiffSnapshot,
  HistoryEntry,
  LatestSnapshot,
} from '@truecourse/core/types/snapshot';
import type {
  VerifyDiff,
  VerifyHistoryEntry,
  VerifyLatest,
  VerifyRunSnapshot,
} from '@truecourse/core/types/verify-snapshot';

const REPO = 'workspace-1/my-repo';

// --- minimal-but-faithful fixtures (the store round-trips JSON verbatim) ------

const emptyGraph = { services: [], modules: [], methods: [], databases: [], edges: [] };

const aSnap = (id: string, createdAt: string, marker: string): AnalysisSnapshot =>
  ({
    id,
    createdAt,
    branch: 'main',
    commitHash: 'deadbeef',
    architecture: 'monolith',
    status: 'completed',
    metadata: { marker },
    graph: emptyGraph,
    violations: { added: [], resolved: [], previousAnalysisId: null },
    usage: [],
  }) as unknown as AnalysisSnapshot;

const aHist = (id: string, filename: string, createdAt: string): HistoryEntry =>
  ({
    id,
    filename,
    createdAt,
    branch: 'main',
    commitHash: 'deadbeef',
    metadata: null,
    counts: {
      services: 0,
      modules: 0,
      methods: 0,
      violations: { new: 0, unchanged: 0, resolved: 0, bySeverity: {} },
    },
    usage: { totalTokens: 0, totalCostUsd: '0', durationMs: 0, provider: 'claude' },
  }) as unknown as HistoryEntry;

const vSnap = (id: string, verifiedAt: string): VerifyRunSnapshot =>
  ({
    id,
    verifiedAt,
    branch: 'main',
    commitHash: 'deadbeef',
    contractsDir: 'reference',
    codeDir: 'src',
    artifactCount: 3,
    extractedOperationCount: 5,
    drifts: [],
    resolverErrors: [],
    unresolvedRefs: [],
  }) as unknown as VerifyRunSnapshot;

const vHist = (id: string, filename: string, verifiedAt: string): VerifyHistoryEntry =>
  ({
    id,
    filename,
    verifiedAt,
    branch: 'main',
    commitHash: 'deadbeef',
    artifactCount: 3,
    driftCount: 0,
    bySeverity: {},
  }) as unknown as VerifyHistoryEntry;

function setup() {
  const client = new PGlite();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ds-blob-'));
  const blob = new FsBlobStore(dir);
  return { client, dir, blob };
}

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

describe('PgBlobAnalysisStore (pglite + fs blob)', () => {
  let client: PGlite;
  let dir: string;
  let store: PgBlobAnalysisStore;

  beforeEach(async () => {
    const s = setup();
    client = s.client;
    dir = s.dir;
    store = new PgBlobAnalysisStore(await makeDb(client), s.blob);
  });
  afterEach(async () => {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('latest: round-trips and deletes', async () => {
    expect(await store.readLatest(REPO)).toBeNull();
    const latest = {
      head: 'f.json',
      analysis: {
        id: 'a1',
        createdAt: '2026-01-01T00:00:00Z',
        branch: 'main',
        commitHash: 'x',
        architecture: 'monolith',
        metadata: null,
        status: 'completed',
      },
      graph: emptyGraph,
      violations: [],
    } as unknown as LatestSnapshot;
    await store.writeLatest(REPO, latest);
    expect(await store.readLatest(REPO)).toEqual(latest);
    await store.deleteLatest(REPO);
    expect(await store.readLatest(REPO)).toBeNull();
    // delete is idempotent on a missing key
    await expect(store.deleteLatest(REPO)).resolves.toBeUndefined();
  });

  it('analyses: write/read/list/find/delete with per-repo scoping', async () => {
    const s1 = aSnap('a1', '2026-01-01T00:00:00.000Z', 'one');
    const s2 = aSnap('a2', '2026-01-02T00:00:00.000Z', 'two');
    const w1 = await store.writeAnalysis(REPO, s1);
    const w2 = await store.writeAnalysis(REPO, s2);
    // a different repo must not bleed into REPO's listing
    await store.writeAnalysis('other/repo', aSnap('a9', '2026-01-03T00:00:00.000Z', 'x'));

    expect(await store.readAnalysis(REPO, w1.filename)).toEqual(s1);
    expect(await store.readAnalysis(REPO, 'missing.json')).toBeNull();

    // listed ascending (ISO-prefixed filename = chronological)
    expect(await store.listAnalyses(REPO)).toEqual([w1.filename, w2.filename]);

    expect(await store.findAnalysisFilename(REPO, 'a2')).toBe(w2.filename);
    expect(await store.findAnalysisFilename(REPO, 'nope')).toBeNull();

    await store.deleteAnalysis(REPO, w1.filename);
    expect(await store.listAnalyses(REPO)).toEqual([w2.filename]);
    expect(await store.readAnalysis(REPO, w1.filename)).toBeNull();
  });

  it('findAnalysisFilename returns the newest filename for a re-used id', async () => {
    const early = await store.writeAnalysis(REPO, aSnap('dup', '2026-01-01T00:00:00.000Z', 'a'));
    const late = await store.writeAnalysis(REPO, aSnap('dup', '2026-02-01T00:00:00.000Z', 'b'));
    expect(early.filename).not.toBe(late.filename);
    expect(await store.findAnalysisFilename(REPO, 'dup')).toBe(late.filename);
  });

  it('history: append preserves order; remove filters by id', async () => {
    expect(await store.readHistory(REPO)).toEqual({ analyses: [] });
    const h1 = aHist('a1', 'f1.json', '2026-01-01T00:00:00Z');
    const h2 = aHist('a2', 'f2.json', '2026-01-02T00:00:00Z');
    await store.appendHistory(REPO, h1);
    await store.appendHistory(REPO, h2);
    expect(await store.readHistory(REPO)).toEqual({ analyses: [h1, h2] });

    await store.removeFromHistory(REPO, 'a1');
    expect(await store.readHistory(REPO)).toEqual({ analyses: [h2] });
    // no-op for an unknown id
    await store.removeFromHistory(REPO, 'nope');
    expect(await store.readHistory(REPO)).toEqual({ analyses: [h2] });
  });

  it('diff: round-trips and deletes', async () => {
    expect(await store.readDiff(REPO)).toBeNull();
    const diff = { id: 'd1', newViolations: [], resolvedViolations: [] } as unknown as DiffSnapshot;
    await store.writeDiff(REPO, diff);
    expect(await store.readDiff(REPO)).toEqual(diff);
    await store.deleteDiff(REPO);
    expect(await store.readDiff(REPO)).toBeNull();
  });
});

describe('PgBlobVerifyStore (pglite + fs blob)', () => {
  let client: PGlite;
  let dir: string;
  let store: PgBlobVerifyStore;

  beforeEach(async () => {
    const s = setup();
    client = s.client;
    dir = s.dir;
    store = new PgBlobVerifyStore(await makeDb(client), s.blob);
  });
  afterEach(async () => {
    await client.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('latest + diff: round-trip and delete', async () => {
    expect(await store.readVerifyLatest(REPO)).toBeNull();
    const latest = { head: 'f.json', run: { id: 'r1' }, drifts: [] } as unknown as VerifyLatest;
    await store.writeVerifyLatest(REPO, latest);
    expect(await store.readVerifyLatest(REPO)).toEqual(latest);
    await store.deleteVerifyLatest(REPO);
    expect(await store.readVerifyLatest(REPO)).toBeNull();

    const diff = { id: 'd1', baseRunId: 'r0', added: [], resolved: [] } as unknown as VerifyDiff;
    await store.writeVerifyDiff(REPO, diff);
    expect(await store.readVerifyDiff(REPO)).toEqual(diff);
    await store.deleteVerifyDiff(REPO);
    expect(await store.readVerifyDiff(REPO)).toBeNull();
  });

  it('runs: write/read/list + history append', async () => {
    const w1 = await store.writeVerifyRun(REPO, vSnap('r1', '2026-01-01T00:00:00.000Z'));
    const w2 = await store.writeVerifyRun(REPO, vSnap('r2', '2026-01-02T00:00:00.000Z'));
    expect(await store.readVerifyRun(REPO, w1.filename)).toEqual(vSnap('r1', '2026-01-01T00:00:00.000Z'));
    expect(await store.listVerifyRuns(REPO)).toEqual([w1.filename, w2.filename]);

    await store.appendVerifyHistory(REPO, vHist('r1', w1.filename, '2026-01-01T00:00:00.000Z'));
    await store.appendVerifyHistory(REPO, vHist('r2', w2.filename, '2026-01-02T00:00:00.000Z'));
    const hist = await store.readVerifyHistory(REPO);
    expect(hist.runs.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('deleteVerifyRun re-materializes LATEST to the newest remaining run', async () => {
    const w1 = await store.writeVerifyRun(REPO, vSnap('r1', '2026-01-01T00:00:00.000Z'));
    const w2 = await store.writeVerifyRun(REPO, vSnap('r2', '2026-01-02T00:00:00.000Z'));
    await store.appendVerifyHistory(REPO, vHist('r1', w1.filename, '2026-01-01T00:00:00.000Z'));
    await store.appendVerifyHistory(REPO, vHist('r2', w2.filename, '2026-01-02T00:00:00.000Z'));
    // LATEST points at r2 (the head)
    await store.writeVerifyLatest(REPO, { head: w2.filename, run: { id: 'r2' } } as unknown as VerifyLatest);
    await store.writeVerifyDiff(REPO, { id: 'd', baseRunId: 'r2' } as unknown as VerifyDiff);

    // delete r2 (the LATEST head) → re-materialize to r1, drop the obsolete diff
    expect(await store.deleteVerifyRun(REPO, 'r2')).toBe(true);
    expect(await store.listVerifyRuns(REPO)).toEqual([w1.filename]);
    const latest = await store.readVerifyLatest(REPO);
    expect(latest?.head).toBe(w1.filename);
    expect(latest?.run.id).toBe('r1');
    expect(await store.readVerifyDiff(REPO)).toBeNull();
    expect((await store.readVerifyHistory(REPO)).runs.map((r) => r.id)).toEqual(['r1']);
  });

  it('deleteVerifyRun deletes LATEST when the last run is removed; false for unknown id', async () => {
    const w1 = await store.writeVerifyRun(REPO, vSnap('r1', '2026-01-01T00:00:00.000Z'));
    await store.appendVerifyHistory(REPO, vHist('r1', w1.filename, '2026-01-01T00:00:00.000Z'));
    await store.writeVerifyLatest(REPO, { head: w1.filename, run: { id: 'r1' } } as unknown as VerifyLatest);

    expect(await store.deleteVerifyRun(REPO, 'nope')).toBe(false);
    expect(await store.deleteVerifyRun(REPO, 'r1')).toBe(true);
    expect(await store.readVerifyLatest(REPO)).toBeNull();
    expect(await store.listVerifyRuns(REPO)).toEqual([]);
  });

  it('deleteVerifyRun keeps LATEST when a non-head run is removed', async () => {
    const w1 = await store.writeVerifyRun(REPO, vSnap('r1', '2026-01-01T00:00:00.000Z'));
    const w2 = await store.writeVerifyRun(REPO, vSnap('r2', '2026-01-02T00:00:00.000Z'));
    await store.appendVerifyHistory(REPO, vHist('r1', w1.filename, '2026-01-01T00:00:00.000Z'));
    await store.appendVerifyHistory(REPO, vHist('r2', w2.filename, '2026-01-02T00:00:00.000Z'));
    await store.writeVerifyLatest(REPO, { head: w2.filename, run: { id: 'r2' } } as unknown as VerifyLatest);

    // delete r1 (NOT the head) → LATEST untouched
    expect(await store.deleteVerifyRun(REPO, 'r1')).toBe(true);
    expect((await store.readVerifyLatest(REPO))?.head).toBe(w2.filename);
    expect(await store.listVerifyRuns(REPO)).toEqual([w2.filename]);
  });
});
