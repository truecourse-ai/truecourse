import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { type Express } from 'express';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgSpecStore } from '../../ee/packages/data-store/src/index';
import type { LatestSnapshot } from '@truecourse/core/types/snapshot';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
    createSocketSpecEstimateHandler: () => () => Promise.resolve(true),
  };
});

// The PR-head re-curate runs the full curate pipeline (LLM); its own docSource
// wiring is covered in tests/core + tests/ee-data-store. Stub it here so the route
// test asserts the route INVOKES it and acts on the conflict count.
vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return { ...actual, recuratePrCorpus: vi.fn() };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import { recuratePrCorpus, getDecisions } from '@truecourse/core/commands/spec-in-process';
import { setSpecStore, resetSpecStore } from '@truecourse/core/lib/spec-store';
import { resetAnalysisStore, writeLatest } from '@truecourse/core/lib/analysis-store';
import { setRepoDocReader } from '@truecourse/core/lib/repo-doc-reader';
import { setBackgroundTaskRunner, type BackgroundTask } from '@truecourse/core/lib/background-tasks';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

async function makeDb(client: PGlite): Promise<Db> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as Db;
}

// A minimal LATEST analysis stamped at `commit` — the baseline the corpus reader
// anchors on. `baselineCommit` reads `analysis.commitHash` from the analyze store.
const baselineLatest = (commit: string): LatestSnapshot =>
  ({
    head: `${commit}.json`,
    analysis: {
      id: `an-${commit}`,
      createdAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commitHash: commit,
      architecture: 'monolith',
      metadata: null,
      status: 'completed',
    },
    graph: { nodes: [], edges: [] },
    violations: [],
  }) as unknown as LatestSnapshot;

const corpusWithArea = (areaId: string) => ({
  version: 3,
  generatedAt: '2026-01-01T00:00:00Z',
  docs: [{ ref: 'docs/v.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: [areaId] }],
  areas: [{ id: areaId, product: 'p', concern: 'c', docRefs: ['docs/v.md'], overlaps: [] }],
  relations: [],
  skippedDocs: [],
});

// ---------------------------------------------------------------------------
// Corpus route — commit-scoped reads (EE: Postgres spec store; the baseline
// commit is read from the core analyze store's LATEST).
// ---------------------------------------------------------------------------

describe('GET /spec/corpus?ref (EE, commit-scoped)', () => {
  let app: Express;
  let fixture: TestFixture;
  let client: PGlite;
  let spec: PgSpecStore;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    client = new PGlite();
    const db = await makeDb(client);
    spec = new PgSpecStore(db);
    setSpecStore(spec);
    // Baseline anchored at base1 (the analyze LATEST the corpus reader anchors
    // on). Seeded via the core file analyze store.
    await writeLatest(fixture.repoPath, baselineLatest('base1'));
    await spec.saveSpec({ repoKey: fixture.repoPath, commitSha: 'base1' }, 'corpus', corpusWithArea('base/area'));
    await spec.saveSpec({ repoKey: fixture.repoPath, commitSha: 'head1' }, 'corpus', corpusWithArea('head/area'));
    app = createApp({ serveStatic: false, authVerifier: null });
  });
  afterEach(async () => {
    resetSpecStore();
    resetAnalysisStore();
    await client.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('no ref → the baseline-commit corpus (never loadLatest), labelled corpusCommit', async () => {
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(res.body.corpus.areas[0].id).toBe('base/area');
    expect(res.body.corpusCommit).toBe('base1');
  });

  it('ref=<head> → the PR-head corpus at that commit', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/corpus`)
      .query({ ref: 'head1' })
      .expect(200);
    expect(res.body.corpus.areas[0].id).toBe('head/area');
    expect(res.body.corpusCommit).toBe('head1');
  });

  it('ref with no stored corpus (code-only PR) → falls back to the baseline corpus', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/corpus`)
      .query({ ref: 'codeonly' })
      .expect(200);
    expect(res.body.corpus.areas[0].id).toBe('base/area');
    expect(res.body.corpusCommit).toBe('base1'); // labelled so the client can note the fallback
  });
});

describe('GET /spec/corpus?ref — 404 when neither ref nor baseline has a corpus', () => {
  let app: Express;
  let fixture: TestFixture;
  let client: PGlite;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    client = new PGlite();
    const db = await makeDb(client);
    setSpecStore(new PgSpecStore(db));
    // No baseline analysis written → baselineCommit resolves to null.
    app = createApp({ serveStatic: false, authVerifier: null });
  });
  afterEach(async () => {
    resetSpecStore();
    resetAnalysisStore();
    await client.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns 404', async () => {
    await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/corpus`)
      .query({ ref: 'whatever' })
      .expect(404);
  });
});

// ---------------------------------------------------------------------------
// Doc route — the new &commit param reaches the reader seam.
// ---------------------------------------------------------------------------

describe('GET /spec/doc?ref=<path>&commit=<sha>', () => {
  let app: Express;
  let fixture: TestFixture;
  let seen: Array<{ docPath: string; commit?: string }>;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    seen = [];
    setRepoDocReader(async (_repoKey, docPath, opts) => {
      seen.push({ docPath, commit: opts?.commit });
      return `# doc ${docPath} @ ${opts?.commit ?? 'default'}`;
    });
    app = createApp({ serveStatic: false, authVerifier: null });
  });
  afterEach(async () => {
    setRepoDocReader(async () => null);
    await teardownTestFixture(fixture.project.slug);
  });

  it('threads commit through to the reader', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/doc`)
      .query({ ref: 'docs/v.md', commit: 'abc123' })
      .expect(200);
    expect(res.body.content).toContain('abc123');
    expect(seen).toEqual([{ docPath: 'docs/v.md', commit: 'abc123' }]);
  });

  it('omitting commit reads at the reader default', async () => {
    await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/doc`)
      .query({ ref: 'docs/v.md' })
      .expect(200);
    expect(seen).toEqual([{ docPath: 'docs/v.md', commit: undefined }]);
  });
});

// ---------------------------------------------------------------------------
// Mutation routes — PR scope (?pr + ?ref) writes the overlay + re-gates.
// ---------------------------------------------------------------------------

describe('mutation routes — PR scope', () => {
  let app: Express;
  let fixture: TestFixture;
  let client: PGlite;
  let tasks: BackgroundTask[];

  beforeEach(async () => {
    fixture = await setupTestFixture();
    client = new PGlite();
    setSpecStore(new PgSpecStore(await makeDb(client)));
    vi.mocked(recuratePrCorpus).mockReset();
    tasks = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    app = createApp({ serveStatic: false, authVerifier: null });
  });
  afterEach(async () => {
    setBackgroundTaskRunner(null);
    resetSpecStore();
    await client.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('POST /spec/includes?pr writes the PR overlay and — conflict-free — enqueues pr.regate', async () => {
    vi.mocked(recuratePrCorpus).mockResolvedValueOnce({
      corpus: { docs: [{ ref: 'docs/v.md' }] } as never,
      openConflicts: 0,
    });
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/includes`)
      .query({ pr: 7, ref: 'head1' })
      .send({ ref: 'docs/v.md' })
      .expect(200);
    // response carries the PR-scoped (merged) decisions + the head corpusCommit
    expect(res.body.manualIncludes).toContain('docs/v.md');
    expect(res.body.corpusCommit).toBe('head1');
    expect(vi.mocked(recuratePrCorpus)).toHaveBeenCalledWith(fixture.repoPath, 'head1', 7);
    // the overlay was written to the PR scope, not the repo row
    expect((await getDecisions(fixture.repoPath)).manualIncludes).toEqual([]);
    expect((await getDecisions(fixture.repoPath, { pr: 7 })).manualIncludes).toContain('docs/v.md');
    expect(tasks).toEqual([{ type: 'pr.regate', repoKey: fixture.repoPath, prNumber: 7 }]);
  });

  it('does NOT enqueue pr.regate while the PR still has conflicts', async () => {
    vi.mocked(recuratePrCorpus).mockResolvedValueOnce({
      corpus: { docs: [{ ref: 'docs/v.md' }] } as never,
      openConflicts: 2,
    });
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .query({ pr: 7, ref: 'head1' })
      .send({ ref: 'docs/v.md' })
      .expect(200);
    expect(tasks).toEqual([]);
  });

  it('?pr without ref → 400', async () => {
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/includes`)
      .query({ pr: 7 })
      .send({ ref: 'docs/v.md' })
      .expect(400);
    expect(vi.mocked(recuratePrCorpus)).not.toHaveBeenCalled();
  });
});
