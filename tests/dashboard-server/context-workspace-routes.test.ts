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
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';
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
  createSessionRun,
  resetSessionsRootResolver,
  setSessionsRootResolver,
  workspaceSessionsKey,
} from '@truecourse/core/lib/sessions-store';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SRC_A = 'repo-acme-widgets';
const SRC_B = 'stripe-docs';
const ref = (sourceId: string, name: string): string => `context/${sourceId}/${name}`;

let app: Express;
let fixture: TestFixture;
let jobs: StubJobs;
let context: ContextStore;
let home: string;

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
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-ctx-routes-'));
  setSessionsRootResolver(() => path.join(home, 'sessions'));
  jobs = stubJobs();
  app = createTestApp({ jobs: jobs.mount });
});

afterEach(async () => {
  resetContextStore();
  resetSpecStore();
  resetSessionsRootResolver();
  fs.rmSync(home, { recursive: true, force: true });
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

// ---------------------------------------------------------------------------
// GET /api/context/corpus + the workspace decisions
// ---------------------------------------------------------------------------

describe('the workspace corpus and its decisions', () => {
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

  it('records a force-exclude once, for the whole workspace', async () => {
    const add = await request(app)
      .post('/api/context/excludes')
      .send({ ref: ref(SRC_B, 'site.md') })
      .expect(200);
    expect(add.body.manualExcludes).toEqual([ref(SRC_B, 'site.md')]);

    const drop = await request(app)
      .delete('/api/context/excludes')
      .send({ ref: ref(SRC_B, 'site.md') })
      .expect(200);
    expect(drop.body.manualExcludes).toEqual([]);
  });

  it('records a force-include, and refuses a request with no ref', async () => {
    const add = await request(app)
      .post('/api/context/includes')
      .send({ ref: ref(SRC_A, 'one.md') })
      .expect(200);
    expect(add.body.manualIncludes).toEqual([ref(SRC_A, 'one.md')]);
    await request(app).post('/api/context/includes').send({}).expect(400);
  });

  it('settles a conflict once, and takes it back', async () => {
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

    const del = await request(app)
      .delete('/api/context/conflict-resolution')
      .send({ docA: verdict.docA, anchorA: verdict.anchorA, docB: verdict.docB, anchorB: verdict.anchorB })
      .expect(200);
    expect(del.body.conflictResolutions).toEqual([]);
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
// GET /api/context/runs — the workspace's own agent runs
// ---------------------------------------------------------------------------

describe('GET /api/context/runs', () => {
  it('lists the workspace’s scans, which belong to no repository', async () => {
    const run = createSessionRun(workspaceSessionsKey(TEST_ORG), {
      command: 'spec-scan',
      gitRef: 'workspace',
    });
    run.finish('completed');

    const res = await request(app).get('/api/context/runs').expect(200);
    expect(res.body.runs).toHaveLength(1);
    expect(res.body.runs[0]).toMatchObject({ command: 'spec-scan', status: 'completed' });
    // Never the session endpoint — it carries a token.
    expect(res.body.runs[0]).not.toHaveProperty('endpoint');
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

  it('starts the Document scan when the set actually differs', async () => {
    const res = await request(app)
      .put(`/api/repos/${fixture.project.slug}/context/bindings`)
      .send({ sourceIds: [SRC_B] })
      .expect(200);

    expect(res.body.sourceIds).toEqual([SRC_B]);
    expect(res.body.jobId).toBe('job_test');
    expect(jobs.contextScans).toEqual([{ workspaceOrgId: TEST_ORG, source: 'link' }]);
  });

  it('starts nothing when the set is saved unchanged', async () => {
    await setContextBindings(TEST_ORG, fixture.project.name, [SRC_B]);

    const res = await request(app)
      .put(`/api/repos/${fixture.project.slug}/context/bindings`)
      .send({ sourceIds: [SRC_B] })
      .expect(200);

    expect(res.body.jobId).toBeUndefined();
    expect(jobs.contextScans).toEqual([]);
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
// The per-repository routes, mapped (slice 4 removes them)
// ---------------------------------------------------------------------------

describe('the repository routes the client still calls', () => {
  it('POST /spec/corpus/scan enqueues the WORKSPACE scan and answers as before', async () => {
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/corpus/scan`)
      .expect(202);

    expect(res.body).toEqual({ jobId: 'job_test' });
    expect(jobs.contextScans).toEqual([{ workspaceOrgId: TEST_ORG, source: 'manual' }]);
    expect(jobs.scans).toEqual([]);
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
