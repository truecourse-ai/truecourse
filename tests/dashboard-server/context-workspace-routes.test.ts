/**
 * The WORKSPACE-scoped Context routes: the Document scan a page starts, the
 * staleness dot it draws, the corpus and decisions the workspace settles once,
 * the workspace's own agent runs — and the two per-repository routes that are
 * mapped onto them until slice 4 removes them.
 *
 * Nothing here runs the scan: the queue is stubbed, so what is pinned is the
 * ROUTE — what it enqueues, what it refuses, and what it answers with.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
  };
});

import { createTestApp, stubJobs, TEST_ORG, type StubJobs } from '../helpers/test-app';
import {
  clearTestRegistry,
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-fixture';
import { contextIsStale } from '../../apps/dashboard/server/src/services/context-scan.service';
import { memoryContextStore } from '../helpers/memory-context-store';
import { memorySpecStore } from '../helpers/memory-spec-store';
import {
  resetContextStore,
  setContextBindings,
  setContextStore,
  type ContextStore,
} from '@truecourse/core/lib/context-store';
import {
  resetSpecStore,
  saveWorkspaceSpec,
  setSpecStore,
} from '@truecourse/core/lib/spec-store';
import {
  resetGuardStore,
  setGuardStore,
  type GuardStore,
} from '@truecourse/core/lib/guard-store';
import { setGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import type { GuardGenerateReport } from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';

const SRC_A = 'repo-acme-widgets';
const SRC_B = 'stripe-docs';
const ref = (sourceId: string, name: string): string => `context/${sourceId}/${name}`;

let app: Express;
let fixture: TestFixture;
let jobs: StubJobs;
let context: ContextStore;

const corpus = (): CuratedCorpus => ({
  version: 3,
  generatedAt: '2026-01-01T00:00:00Z',
  docs: [
    { ref: ref(SRC_A, 'one.md'), kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: SRC_A, sourceKind: 'repository' },
    { ref: ref(SRC_B, 'site.md'), kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: SRC_B, sourceKind: 'site' },
  ],
  areas: [
    {
      id: 'p/c',
      product: 'p',
      concern: 'c',
      docRefs: [ref(SRC_A, 'one.md'), ref(SRC_B, 'site.md')],
      overlaps: [],
    },
  ],
  skippedDocs: [],
});

beforeEach(async () => {
  fixture = await setupTestFixture();
  context = memoryContextStore();
  setContextStore(context);
  setSpecStore(memorySpecStore());
  jobs = stubJobs();
  app = createTestApp({ jobs: jobs.mount });
});

afterEach(async () => {
  resetContextStore();
  resetSpecStore();
  await teardownTestFixture(fixture.project.slug);
});

// ---------------------------------------------------------------------------
// POST /api/context/scan
// ---------------------------------------------------------------------------

describe('POST /api/context/scan', () => {
  it('enqueues the workspace Document scan and answers 202', async () => {
    const res = await request(app).post('/api/context/scan').expect(202);

    expect(res.body).toEqual({ jobId: 'job_test' });
    expect(jobs.contextScans).toEqual([{ workspaceOrgId: TEST_ORG, source: 'manual' }]);
  });

  it('answers 409 while one is already running', async () => {
    jobs.answer = { status: 'busy' };
    const res = await request(app).post('/api/context/scan').expect(409);
    expect(res.body.error).toMatch(/already running/i);
  });
});

// ---------------------------------------------------------------------------
// GET /api/context/staleness
// ---------------------------------------------------------------------------

describe('GET /api/context/staleness', () => {
  it('is not stale before the first scan — there is nothing to be behind', async () => {
    const res = await request(app).get('/api/context/staleness').expect(200);
    expect(res.body).toEqual({ changedAt: null, corpusAt: null, stale: false });
  });

  it('goes stale when the context moved after the corpus was built', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
    const fresh = await request(app).get('/api/context/staleness').expect(200);
    expect(fresh.body).toMatchObject({ corpusAt: '2026-01-01T00:00:00Z', stale: false });

    await context.recordSync(TEST_ORG, {
      sourceId: SRC_A,
      at: '2026-02-01T00:00:00.000Z',
      parentAt: null,
      added: 1,
      changed: 0,
      removed: 0,
      unchanged: 0,
    });

    const stale = await request(app).get('/api/context/staleness').expect(200);
    expect(stale.body).toMatchObject({ changedAt: '2026-02-01T00:00:00.000Z', stale: true });
  });
});

describe('the staleness comparison', () => {
  it('reads the two stamps as instants, whatever precision they carry', () => {
    // Same instant, different precision: '…:00Z' sorts AFTER '…:00.000Z' as
    // text, which would report a fresh corpus as stale.
    expect(contextIsStale('2026-01-01T00:00:00Z', '2026-01-01T00:00:00.000Z')).toBe(false);
    expect(contextIsStale('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:01.000Z')).toBe(true);
  });

  it('is never stale without both stamps', () => {
    expect(contextIsStale(null, '2026-01-01T00:00:00.000Z')).toBe(false);
    expect(contextIsStale('2026-01-01T00:00:00.000Z', null)).toBe(false);
  });
});

/**
 * A decision about WHICH documents the corpus should hold changes nothing until
 * the next scan applies it — so recording one has to light the amber dot that
 * says a scan is what is missing. Anything less records a decision that looks
 * like it took effect and did not.
 */
describe('an inclusion decision says a scan is needed', () => {
  const stamp = async (): Promise<{ changedAt: string | null; stale: boolean }> =>
    (await request(app).get('/api/context/staleness').expect(200)).body;

  it('moves the workspace’s changed-at stamp, on each of the four writes', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
    expect(await stamp()).toMatchObject({ changedAt: null, stale: false });

    const writes = [
      ['post', '/api/context/includes'],
      ['delete', '/api/context/includes'],
      ['post', '/api/context/excludes'],
      ['delete', '/api/context/excludes'],
    ] as const;
    let previous: string | null = null;
    for (const [verb, path] of writes) {
      await request(app)[verb](path).send({ ref: ref(SRC_A, 'one.md') }).expect(200);
      const { changedAt } = await stamp();
      expect(changedAt).not.toBeNull();
      if (previous) expect(changedAt! >= previous).toBe(true);
      previous = changedAt;
    }
    expect((await stamp()).stale).toBe(true);
  });

  it('leaves the stamp alone for a conflict verdict, which a scan does not apply', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
    await request(app)
      .post('/api/context/conflict-resolution')
      .send({
        docA: ref(SRC_A, 'one.md'),
        anchorA: 'Cancellation',
        docB: ref(SRC_B, 'site.md'),
        anchorB: 'Cancellation',
        verdict: 'a',
      })
      .expect(200);
    expect(await stamp()).toMatchObject({ changedAt: null, stale: false });
  });
});

// ---------------------------------------------------------------------------
// GET /api/context/corpus + the workspace decisions
// ---------------------------------------------------------------------------

describe('the workspace corpus and its decisions', () => {
  /** The corpus payload the pages read — decisions folded in. */
  const read = async (): Promise<{
    manualIncludes: string[];
    manualExcludes: string[];
    conflictResolutions: unknown[];
  }> => (await request(app).get('/api/context/corpus').expect(200)).body;

  it('404s before the first scan', async () => {
    const res = await request(app).get('/api/context/corpus').expect(404);
    expect(res.body.error).toMatch(/no documents/i);
  });

  it('answers the whole workspace corpus with its decisions', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
    const res = await request(app).get('/api/context/corpus').expect(200);

    expect(res.body.corpus.docs.map((d: { ref: string }) => d.ref)).toEqual([
      ref(SRC_A, 'one.md'),
      ref(SRC_B, 'site.md'),
    ]);
    // The documents carry their source in the artifact — nothing is enriched.
    expect(res.body.corpus.docs[1]).toMatchObject({ sourceId: SRC_B, sourceKind: 'site' });
    expect(res.body).toMatchObject({ manualIncludes: [], manualExcludes: [], conflictResolutions: [] });
  });

  // The round trip is the point: the corpus read folds the WORKSPACE decisions,
  // so a decision that does not come back out of it is a decision nothing acts
  // on, however cheerful the ack was.
  it('records a force-exclude once, for the whole workspace', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
    const add = await request(app)
      .post('/api/context/excludes')
      .send({ ref: ref(SRC_B, 'site.md') })
      .expect(200);
    expect(add.body.manualExcludes).toEqual([ref(SRC_B, 'site.md')]);
    expect((await read()).manualExcludes).toEqual([ref(SRC_B, 'site.md')]);

    const drop = await request(app)
      .delete('/api/context/excludes')
      .send({ ref: ref(SRC_B, 'site.md') })
      .expect(200);
    expect(drop.body.manualExcludes).toEqual([]);
    expect((await read()).manualExcludes).toEqual([]);
  });

  it('records a force-include, and refuses a request with no ref', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
    const add = await request(app)
      .post('/api/context/includes')
      .send({ ref: ref(SRC_A, 'one.md') })
      .expect(200);
    expect(add.body.manualIncludes).toEqual([ref(SRC_A, 'one.md')]);
    expect((await read()).manualIncludes).toEqual([ref(SRC_A, 'one.md')]);

    const drop = await request(app)
      .delete('/api/context/includes')
      .send({ ref: ref(SRC_A, 'one.md') })
      .expect(200);
    expect(drop.body.manualIncludes).toEqual([]);
    expect((await read()).manualIncludes).toEqual([]);

    await request(app).post('/api/context/includes').send({}).expect(400);
  });

  it('settles a conflict once, and takes it back', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
    const verdict = {
      docA: ref(SRC_A, 'one.md'),
      anchorA: 'Cancellation',
      docB: ref(SRC_B, 'site.md'),
      anchorB: 'Cancellation policy',
      verdict: 'b',
    };
    const add = await request(app).post('/api/context/conflict-resolution').send(verdict).expect(200);
    expect(add.body.conflictResolutions).toHaveLength(1);
    expect(add.body.conflictResolutions[0]).toMatchObject({ verdict: 'b', docA: verdict.docA });
    expect((await read()).conflictResolutions).toHaveLength(1);

    const del = await request(app)
      .delete('/api/context/conflict-resolution')
      .send({ docA: verdict.docA, anchorA: verdict.anchorA, docB: verdict.docB, anchorB: verdict.anchorB })
      .expect(200);
    expect(del.body.conflictResolutions).toEqual([]);
    expect((await read()).conflictResolutions).toEqual([]);
  });

  it('refuses a malformed conflict verdict', async () => {
    await request(app)
      .post('/api/context/conflict-resolution')
      .send({ docA: 'a', docB: 'a', verdict: 'b' })
      .expect(400);
    await request(app)
      .post('/api/context/conflict-resolution')
      .send({ docA: 'a', docB: 'b', verdict: 'maybe' })
      .expect(400);
  });
});

// ---------------------------------------------------------------------------
// The decision that unblocks a Test generation
//
// `guard generate` stops on an open conflict and stores an `open-conflicts`
// report. The decision that settles the last conflict of a repository's SLICE
// is what makes that generation runnable again, and nothing else notices — no
// scan follows a decision. One workspace decision may free several
// repositories, and must free only the ones it actually cleared.
// ---------------------------------------------------------------------------

describe('a workspace decision unblocks the generation it freed', () => {
  const SRC_C = 'internal-wiki';

  /** Two disputes in one workspace: SRC_A vs SRC_B, and SRC_C against itself. */
  const twoConflicts = (): CuratedCorpus => ({
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: ref(SRC_A, 'one.md'), kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: SRC_A, sourceKind: 'repository' },
      { ref: ref(SRC_B, 'site.md'), kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: SRC_B, sourceKind: 'site' },
      { ref: ref(SRC_C, 'w1.md'), kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: SRC_C, sourceKind: 'site' },
      { ref: ref(SRC_C, 'w2.md'), kind: 'prd', lastTouched: '', areaTags: ['p/c'], sourceId: SRC_C, sourceKind: 'site' },
    ],
    areas: [
      {
        id: 'p/c',
        product: 'p',
        concern: 'c',
        docRefs: [ref(SRC_A, 'one.md'), ref(SRC_B, 'site.md'), ref(SRC_C, 'w1.md'), ref(SRC_C, 'w2.md')],
        overlaps: [
          {
            docs: [ref(SRC_A, 'one.md'), ref(SRC_B, 'site.md')],
            note: '24h vs 48h',
            sections: [
              { doc: ref(SRC_A, 'one.md'), heading: 'Cancellation' },
              { doc: ref(SRC_B, 'site.md'), heading: 'Cancellation policy' },
            ],
          },
          {
            docs: [ref(SRC_C, 'w1.md'), ref(SRC_C, 'w2.md')],
            note: 'two refund windows',
            sections: [
              { doc: ref(SRC_C, 'w1.md'), heading: 'Refunds' },
              { doc: ref(SRC_C, 'w2.md'), heading: 'Refund window' },
            ],
          },
        ],
      },
    ],
    skippedDocs: [],
  });

  /** The verdict that settles the FIRST dispute, and nothing else. */
  const VERDICT = {
    docA: ref(SRC_A, 'one.md'),
    anchorA: 'Cancellation',
    docB: ref(SRC_B, 'site.md'),
    anchorB: 'Cancellation policy',
    verdict: 'b',
  };

  /** A guard store answering each repository's stored generate report by key. */
  const stubReports = (reports: Record<string, GuardGenerateReport['status']>): void => {
    setGuardStore({
      readGuardBaselineCommit: async () => 'basesha1111',
      readGuardResult: async (repoKey: string) =>
        reports[repoKey] === undefined
          ? null
          : ({ status: reports[repoKey] } as unknown as GuardGenerateReport),
    } as unknown as GuardStore);
  };

  let blocked: TestFixture;
  let other: TestFixture;
  let enqueued: string[];

  beforeEach(async () => {
    // The workspace is exactly the two repositories this suite registers.
    clearTestRegistry();
    blocked = await setupTestFixture();
    other = await setupTestFixture();
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', twoConflicts());
    // `blocked` reads the two documents the verdict settles; `other` reads the
    // dispute nobody is settling here.
    await setContextBindings(TEST_ORG, blocked.project.path, [SRC_A, SRC_B]);
    await setContextBindings(TEST_ORG, other.project.path, [SRC_C]);
    enqueued = [];
    setGuardGenerateEnqueue(async (repoKey) => {
      enqueued.push(repoKey);
    });
  });

  afterEach(() => {
    setGuardGenerateEnqueue(null);
    resetGuardStore();
    clearTestRegistry();
  });

  it('starts the repository whose last conflict cleared, and leaves the one still disputing', async () => {
    stubReports({ [blocked.project.path]: 'open-conflicts', [other.project.path]: 'open-conflicts' });

    await request(app).post('/api/context/conflict-resolution').send(VERDICT).expect(200);

    expect(enqueued).toEqual([blocked.project.path]);
  });

  it('frees every repository the decision cleared, not just the first', async () => {
    await setContextBindings(TEST_ORG, other.project.path, [SRC_A, SRC_B]);
    stubReports({ [blocked.project.path]: 'open-conflicts', [other.project.path]: 'open-conflicts' });

    await request(app).post('/api/context/conflict-resolution').send(VERDICT).expect(200);

    expect([...enqueued].sort()).toEqual([blocked.project.path, other.project.path].sort());
  });

  it('starts nothing for a repository whose generation never stopped', async () => {
    // Its slice is clean after the verdict, but its last generate finished, so
    // there is nothing of its waiting on this decision.
    stubReports({ [blocked.project.path]: 'ok', [other.project.path]: 'open-conflicts' });

    await request(app).post('/api/context/conflict-resolution').send(VERDICT).expect(200);

    expect(enqueued).toEqual([]);
  });

  it('starts the blocked repository off an exclude that removes one side', async () => {
    stubReports({ [blocked.project.path]: 'open-conflicts', [other.project.path]: 'open-conflicts' });

    await request(app)
      .post('/api/context/excludes')
      .send({ ref: ref(SRC_B, 'site.md') })
      .expect(200);

    expect(enqueued).toEqual([blocked.project.path]);
  });

  it('starts nothing while the repository still has a conflict of its own', async () => {
    stubReports({ [blocked.project.path]: 'open-conflicts', [other.project.path]: 'open-conflicts' });

    // A force-include settles no dispute, so both repositories stay blocked.
    await request(app)
      .post('/api/context/includes')
      .send({ ref: ref(SRC_A, 'one.md') })
      .expect(200);

    expect(enqueued).toEqual([]);
  });

  it('saves the decision even when the enqueue throws', async () => {
    stubReports({ [blocked.project.path]: 'open-conflicts' });
    setGuardGenerateEnqueue(async () => {
      throw new Error('the queue is down');
    });

    const res = await request(app).post('/api/context/conflict-resolution').send(VERDICT).expect(200);

    expect(res.body.conflictResolutions).toHaveLength(1);
    const corpusRead = await request(app).get('/api/context/corpus').expect(200);
    expect(corpusRead.body.conflictResolutions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Linking, which changes what the corpus should hold
// ---------------------------------------------------------------------------

describe('PUT /api/repos/:id/context/bindings', () => {
  beforeEach(async () => {
    await context.createSource(TEST_ORG, {
      id: SRC_B,
      kind: 'site',
      title: 'Stripe Docs',
      config: { llmsTxtUrl: 'https://stripe.example/llms.txt' },
    });
  });

  it('hands the changed links to the queue, never a Document scan', async () => {
    const res = await request(app)
      .put(`/api/repos/${fixture.project.slug}/context/bindings`)
      .send({ sourceIds: [SRC_B] })
      .expect(200);

    expect(res.body.sourceIds).toEqual([SRC_B]);
    expect(res.body.started).toBeUndefined();
    expect(jobs.contextScans).toEqual([]);
    expect(jobs.linkChanges).toEqual([
      {
        workspaceOrgId: TEST_ORG,
        repoId: fixture.project.slug,
        repoFullName: fixture.project.name,
        sourceIds: [SRC_B],
      },
    ]);
  });

  it('answers with what the queue started for the repository', async () => {
    jobs.linksAnswer = { repoFullName: fixture.project.name, job: 'guard-generate' };

    const res = await request(app)
      .put(`/api/repos/${fixture.project.slug}/context/bindings`)
      .send({ sourceIds: [SRC_B] })
      .expect(200);

    expect(res.body.started).toBe('guard-generate');
  });

  it('starts nothing when the set is saved unchanged', async () => {
    await setContextBindings(TEST_ORG, fixture.project.name, [SRC_B]);

    const res = await request(app)
      .put(`/api/repos/${fixture.project.slug}/context/bindings`)
      .send({ sourceIds: [SRC_B] })
      .expect(200);

    expect(res.body.started).toBeUndefined();
    expect(jobs.contextScans).toEqual([]);
    expect(jobs.linkChanges).toEqual([]);
  });
});

describe('DELETE /api/context/sources/:id', () => {
  it('re-scans, because the corpus still holds the removed source’s documents', async () => {
    await context.createSource(TEST_ORG, {
      id: SRC_B,
      kind: 'site',
      title: 'Stripe Docs',
      config: { llmsTxtUrl: 'https://stripe.example/llms.txt' },
    });

    const res = await request(app).delete(`/api/context/sources/${SRC_B}`).expect(200);
    expect(res.body.removed).toMatchObject({ id: SRC_B });
    expect(jobs.contextScans).toEqual([{ workspaceOrgId: TEST_ORG, source: 'link' }]);
  });
});

// ---------------------------------------------------------------------------
// What a repository still reads: its SLICE of the workspace corpus, and whether
// the workspace's context has moved under it. It starts no scan of its own —
// `POST /api/repos/:id/spec/corpus/scan` is gone.
// ---------------------------------------------------------------------------

describe('the repository routes over the workspace corpus', () => {
  it('has no per-repository scan route', async () => {
    await request(app).post(`/api/repos/${fixture.project.slug}/spec/corpus/scan`).expect(404);
    expect(jobs.contextScans).toEqual([]);
  });

  it('GET /spec/corpus answers the repository’s slice of the workspace corpus', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
    await setContextBindings(TEST_ORG, fixture.project.path, [SRC_A]);

    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/corpus`)
      .expect(200);

    expect(res.body.corpus.docs.map((d: { ref: string }) => d.ref)).toEqual([ref(SRC_A, 'one.md')]);
    expect(res.body.corpusCommit).toBeUndefined();
  });

  it('GET /spec/staleness reports the workspace’s context staleness', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', corpus());
    const fresh = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/staleness`)
      .expect(200);
    expect(fresh.body).toMatchObject({ hasCorpus: true, docsChanged: false });

    await context.recordSync(TEST_ORG, {
      sourceId: SRC_A,
      at: '2026-02-01T00:00:00.000Z',
      parentAt: null,
      added: 1,
      changed: 0,
      removed: 0,
      unchanged: 0,
    });

    const stale = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/staleness`)
      .expect(200);
    expect(stale.body.docsChanged).toBe(true);
  });
});
