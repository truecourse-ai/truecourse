import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgAnalysisStore } from '../../ee/packages/data-store/src/index';
import type {
  AnalysisSnapshot,
  LatestSnapshot,
  HistoryEntry,
  DiffSnapshot,
} from '@truecourse/core/types/snapshot';
import { buildAnalysisFilename } from '@truecourse/core/lib/analysis-store';

const REPO = 'workspace-1/my-repo';

let client: PGlite;
let db: EeDb;

beforeEach(async () => {
  client = new PGlite();
  const d = drizzle(client, { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS_DIR });
  db = d as unknown as EeDb;
});
afterEach(async () => {
  await client.close();
});

/** A minimal AnalysisSnapshot (only the fields the store round-trips). */
const snap = (id: string, createdAt: string): AnalysisSnapshot =>
  ({
    id,
    createdAt,
    branch: 'main',
    commitHash: id,
    architecture: 'monolith',
    status: 'completed',
    metadata: null,
    graph: { services: [], modules: [], methods: [] },
    violations: { added: [], resolved: [], previousAnalysisId: null },
    usage: [],
  }) as unknown as AnalysisSnapshot;

describe('PgAnalysisStore (analyses / analysis_current / analysis_history)', () => {
  it('writeAnalysis → readAnalysis / listAnalyses / findAnalysisFilename round-trip', async () => {
    const store = new PgAnalysisStore(db);
    expect(await store.listAnalyses(REPO)).toEqual([]);

    const s1 = snap('a1', '2026-01-01T00:00:00.000Z');
    const s2 = snap('a2', '2026-01-02T00:00:00.000Z');
    const w1 = await store.writeAnalysis(REPO, s1);
    const w2 = await store.writeAnalysis(REPO, s2);
    expect(w1.filename).toBe(buildAnalysisFilename('a1', s1.createdAt));

    // Oldest-first, ISO-prefixed → lexicographically sortable.
    expect(await store.listAnalyses(REPO)).toEqual([w1.filename, w2.filename]);
    expect((await store.readAnalysis(REPO, w2.filename))?.id).toBe('a2');
    expect(await store.findAnalysisFilename(REPO, 'a1')).toBe(w1.filename);
    expect(await store.findAnalysisFilename(REPO, 'nope')).toBeNull();

    await store.deleteAnalysis(REPO, w1.filename);
    expect(await store.listAnalyses(REPO)).toEqual([w2.filename]);
  });

  it('LATEST + diff are mutable per-repo singletons', async () => {
    const store = new PgAnalysisStore(db);
    expect(await store.readLatest(REPO)).toBeNull();

    const l1 = { head: 'analyses/x.json', analysis: { id: 'a1' }, graph: {}, violations: [] } as unknown as LatestSnapshot;
    await store.writeLatest(REPO, l1);
    expect((await store.readLatest(REPO) as { analysis: { id: string } }).analysis.id).toBe('a1');

    // overwrite (singleton, not append)
    const l2 = { head: 'analyses/y.json', analysis: { id: 'a2' }, graph: {}, violations: [] } as unknown as LatestSnapshot;
    await store.writeLatest(REPO, l2);
    expect((await store.readLatest(REPO) as { analysis: { id: string } }).analysis.id).toBe('a2');

    await store.deleteLatest(REPO);
    expect(await store.readLatest(REPO)).toBeNull();

    // diff is an independent singleton
    expect(await store.readDiff(REPO)).toBeNull();
    await store.writeDiff(REPO, { id: 'd1', baseAnalysisId: 'a1' } as unknown as DiffSnapshot);
    expect((await store.readDiff(REPO) as { id: string }).id).toBe('d1');
    await store.deleteDiff(REPO);
    expect(await store.readDiff(REPO)).toBeNull();
  });

  it('appendHistory accumulates; removeFromHistory drops by analysis id', async () => {
    const store = new PgAnalysisStore(db);
    expect((await store.readHistory(REPO)).analyses).toEqual([]);

    const entry = (id: string): HistoryEntry =>
      ({ id, filename: `f-${id}`, createdAt: '2026-01-01T00:00:00.000Z' } as unknown as HistoryEntry);
    await store.appendHistory(REPO, entry('a1'));
    await store.appendHistory(REPO, entry('a2'));
    expect((await store.readHistory(REPO)).analyses.map((e) => e.id)).toEqual(['a1', 'a2']);

    await store.removeFromHistory(REPO, 'a1');
    expect((await store.readHistory(REPO)).analyses.map((e) => e.id)).toEqual(['a2']);
  });

  it('keys by repoKey — a different repo sees nothing', async () => {
    const store = new PgAnalysisStore(db);
    await store.writeAnalysis(REPO, snap('a1', '2026-01-01T00:00:00.000Z'));
    expect(await store.listAnalyses('other-org/other-repo')).toEqual([]);
  });
});
