import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { type Express } from 'express';

/** `spec corpus/scan` requires a git repo (like analyze) — init the fixture so the route guard passes. */
function gitInit(dir: string): void {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.co', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
  execSync('git commit -q --allow-empty -m init', { cwd: dir });
}

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitFilesChanged: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
    createSocketSpecEstimateHandler: () => () => Promise.resolve(true),
    createSocketStashConfirmHandler: () => () => Promise.resolve('stash'),
  };
});

// Include/exclude routes re-curate server-side. The curate engine has its own
// suite (tests/spec-consolidator), so stub it to a no-op here — leaving the
// seeded corpus.json intact — and assert the routes INVOKE it (the recheck is
// server-driven, not client-driven).
vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return {
    ...actual,
    curateInProcess: vi.fn(async () => ({ noChanges: false })),
    // EE include/exclude re-curates the stored corpus in-process (its own suite in
    // tests/core covers the docSource wiring). Stub it here so the route test asserts
    // the route INVOKES it — never the heavy repo.contracts job.
    recurateStoredCorpus: vi.fn(async () => null),
  };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import { curateInProcess, recurateStoredCorpus } from '@truecourse/core/commands/spec-in-process';
import {
  setBackgroundTaskRunner,
  type BackgroundTask,
} from '@truecourse/core/lib/background-tasks';
import {
  setContractStore,
  resetContractStore,
  type ContractStore,
} from '@truecourse/core/lib/contract-store';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-db';

/**
 * Spec route tests assert the HTTP shape of the corpus routes. The
 * curate/generate engine has its own suite under tests/spec-consolidator/ and
 * tests/contract-extractor/.
 */

describe('GET /api/repos/:id/spec/decisions', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns the empty default when decisions.json is absent', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/corpus`)
      .expect(404);
    expect(res.body.error).toMatch(/no corpus/i);
  });
});

describe('corpus routes (spec-scan redesign)', () => {
  let app: Express;
  let fixture: TestFixture;

  const seedCorpus = (overlaps: Array<{ docs: [string, string]; note: string }>): void => {
    const specs = path.join(fixture.repoPath, '.truecourse', 'specs');
    fs.mkdirSync(specs, { recursive: true });
    fs.writeFileSync(
      path.join(specs, 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [
          { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
          { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] },
        ],
        areas: [
          { id: 'booking/appointments', product: 'booking', concern: 'appointments', docRefs: ['docs/v1.md', 'docs/v2.md'], overlaps },
        ],
        relations: [],
        skippedDocs: [{ ref: 'docs/archived.md', reason: 'archived directory' }],
      }),
    );
    const docs = path.join(fixture.repoPath, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'v1.md'), '# Booking v1\nCancel up to 24h before.');
    fs.writeFileSync(path.join(docs, 'v2.md'), '# Booking v2\nCancel up to 48h before.');
  };

  beforeEach(async () => {
    fixture = await setupTestFixture();
    gitInit(fixture.repoPath); // include/exclude re-curate → route guards require git
    vi.mocked(curateInProcess).mockClear();
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    setBackgroundTaskRunner(null);
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET /spec/corpus → 404 before any scan', async () => {
    await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(404);
  });

  it('GET /spec/corpus → the corpus', async () => {
    seedCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(res.body.corpus.areas).toHaveLength(1);
    expect(res.body.corpus.areas[0].overlaps).toHaveLength(1);
  });

  it('GET /spec/doc → the markdown content; rejects traversal', async () => {
    seedCorpus([]);
    const ok = await request(app).get(`/api/repos/${fixture.project.slug}/spec/doc`).query({ ref: 'docs/v2.md' }).expect(200);
    expect(ok.body.content).toContain('48h');
    await request(app).get(`/api/repos/${fixture.project.slug}/spec/doc`).query({ ref: '../../etc/passwd' }).expect(400);
  });

  it('has no /spec/relations routes — unknown spec mutations 404', async () => {
    seedCorpus([]);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md' })
      .expect(404);
    await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ older: 'docs/v1.md', newer: 'docs/v2.md' })
      .expect(404);
  });

  // OSS batches decisions: an include/exclude persists to decisions.json and returns
  // the decision lists (no corpus) WITHOUT re-curating. One later Scan materializes
  // the batch. (The old per-click re-curate re-ran the set-level LLM stages each time.)
  it('POST then DELETE /spec/includes records the decision without re-curating (OSS)', async () => {
    seedCorpus([]);
    const add = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    expect(add.body.manualIncludes).toContain('docs/v1.md');
    // No corpus in the ack — the client keeps its optimistic row move until the next Scan.
    expect(add.body.corpus).toBeUndefined();
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();

    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    expect(del.body.manualIncludes).toEqual([]);
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();
  });

  it('POST then DELETE /spec/excludes records the decision without re-curating (OSS)', async () => {
    seedCorpus([]);
    const add = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(add.body.manualExcludes).toContain('docs/v2.md');
    expect(add.body.corpus).toBeUndefined();
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();

    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(del.body.manualExcludes).toEqual([]);
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();
  });

  it('GET /spec/staleness → decisionsPending true after a decision, false after a fresh scan', async () => {
    seedCorpus([]); // corpus generatedAt = 2026-01-01
    // No decisions yet → nothing pending.
    const before = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(before.body.decisionsPending).toBe(false);

    // Recording a decision writes decisions.json (now) → newer than the corpus.
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    const pending = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(pending.body.decisionsPending).toBe(true);

    // A fresh scan re-curates with a newer generatedAt → the pending signal clears.
    const corpusFile = path.join(fixture.repoPath, '.truecourse', 'specs', 'corpus.json');
    const corpus = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
    corpus.generatedAt = '2099-01-01T00:00:00Z';
    fs.writeFileSync(corpusFile, JSON.stringify(corpus));
    const cleared = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(cleared.body.decisionsPending).toBe(false);
  });

  it('force-exclude clears a force-include for the same doc (mutually exclusive)', async () => {
    seedCorpus([]);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    expect(res.body.manualExcludes).toContain('docs/v1.md');
    expect(res.body.manualIncludes ?? []).not.toContain('docs/v1.md');
  });

  it('GET /spec/corpus exposes manualIncludes + skippedDocs', async () => {
    seedCorpus([]);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(res.body.manualIncludes).toContain('docs/v1.md');
    expect(res.body.corpus.skippedDocs).toContainEqual({ ref: 'docs/archived.md', reason: 'archived directory' });
  });

});

// EE (hosted): repo.path is a repoKey, the corpus lives in the store, and there
// is no local git tree. The decision routes must NOT gate on git and must NOT
// enqueue the old repo.contracts job. They re-curate the stored corpus in-process
// (the SAME curate OSS runs, docs sourced through the repo-doc seam), and — only if
// that leaves the spec conflict-free — enqueue a contract regeneration. A
// non-materializing contract store flips the route onto that path.
describe('corpus routes — EE (stored corpus, no live tree)', () => {
  let app: Express;
  let fixture: TestFixture;

  const seedCorpus = (): void => {
    const specs = path.join(fixture.repoPath, '.truecourse', 'specs');
    fs.mkdirSync(specs, { recursive: true });
    fs.writeFileSync(
      path.join(specs, 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [{ ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] }],
        areas: [{ id: 'booking/appointments', product: 'booking', concern: 'appointments', docRefs: ['docs/v2.md'], overlaps: [] }],
        relations: [],
        skippedDocs: [],
      }),
    );
  };

  // Stub the in-process re-curate's outcome (its own docSource wiring is covered in
  // tests/core). `openConflicts` drives the regenerate-or-not decision.
  const stubRecurate = (openConflicts: number): void => {
    vi.mocked(recurateStoredCorpus).mockResolvedValueOnce({
      corpus: { docs: [{ ref: 'docs/keep.md' }] } as unknown as CuratedCorpus,
      openConflicts,
    });
  };

  beforeEach(async () => {
    fixture = await setupTestFixture(); // deliberately NOT git-initialized
    // A store that reports it does NOT materialize in place = hosted EE. Only the
    // capability flag is read by these routes, so a bare stub is sufficient.
    setContractStore({ materializesInPlace: false } as unknown as ContractStore);
    vi.mocked(recurateStoredCorpus).mockReset();
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    resetContractStore();
    setBackgroundTaskRunner(null);
    await teardownTestFixture(fixture.project.slug);
  });

  it('POST /spec/excludes re-curates and — when it leaves the spec conflict-free — enqueues regeneration', async () => {
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus();
    stubRecurate(0);
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200); // was 400 "not a git repository" before the fix
    expect(res.body.manualExcludes).toContain('docs/v2.md');
    expect(vi.mocked(recurateStoredCorpus)).toHaveBeenCalledWith(fixture.repoPath);
    // conflict-free → a plain regeneration intent (no "Refreshing contracts" popup).
    expect(tasks).toEqual([{ type: 'repo.contracts', repoKey: fixture.repoPath }]);
  });

  it('POST /spec/excludes re-curates but does NOT regenerate while conflicts remain', async () => {
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus();
    stubRecurate(2);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(vi.mocked(recurateStoredCorpus)).toHaveBeenCalledWith(fixture.repoPath);
    expect(tasks).toEqual([]); // conflicts remain → cheap re-curate only
  });

  it('DELETE /spec/excludes restores the doc (re-curate; regen still gated on conflict-free)', async () => {
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus();
    stubRecurate(0);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    stubRecurate(0);
    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(del.body.manualExcludes ?? []).not.toContain('docs/v2.md');
  });

});

// ---------------------------------------------------------------------------
// Doc-content staleness (docsChanged, plan item 31d) — the "fix the doc itself"
// resolution path: an external edit bumps the kept doc's mtime past the corpus
// `generatedAt` and lights the Rescan dot. (There is no in-app doc editor.)
// ---------------------------------------------------------------------------

describe('spec docs-content staleness (item 31)', () => {
  let app: Express;
  let fixture: TestFixture;

  const specsDir = () => path.join(fixture.repoPath, '.truecourse', 'specs');
  const DOC = 'docs/spec.md';
  const DOC_BODY = '## rm\nrm archives the task.\n\n## keep\nkeep does nothing.\n';

  // Seed a one-doc corpus whose `generatedAt` is AFTER the doc's (back-dated) mtime,
  // so the docs-content signal starts clean and only flips when the doc is edited.
  const seed = (generatedAt = '2026-06-01T00:00:00Z'): void => {
    fs.mkdirSync(specsDir(), { recursive: true });
    fs.writeFileSync(
      path.join(specsDir(), 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt,
        docs: [{ ref: DOC, kind: 'spec', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/persistence'] }],
        areas: [{ id: 'core/persistence', product: 'core', concern: 'persistence', docRefs: [DOC], overlaps: [] }],
        relations: [],
        skippedDocs: [],
      }),
    );
    fs.mkdirSync(path.join(fixture.repoPath, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(fixture.repoPath, DOC), DOC_BODY);
    const old = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(path.join(fixture.repoPath, DOC), old, old);
  };

  beforeEach(async () => {
    fixture = await setupTestFixture();
    gitInit(fixture.repoPath);
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    setBackgroundTaskRunner(null);
    await teardownTestFixture(fixture.project.slug);
  });

  it('staleness docsChanged is false with a fresh corpus, true after a kept doc is edited on disk', async () => {
    seed();
    const before = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(before.body.docsChanged).toBe(false);
    expect(before.body.decisionsPending).toBe(false);

    // Edit the doc in the working tree (user's own editor) — mtime bumps to now.
    fs.writeFileSync(
      path.join(fixture.repoPath, DOC),
      DOC_BODY.replace('rm archives the task.', 'rm permanently deletes the task.'),
    );

    const after = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(after.body.docsChanged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section-scoped conflict verdicts (item 31b) — POST/DELETE /spec/conflict-resolution
// ---------------------------------------------------------------------------

describe('conflict-resolution routes (item 31b)', () => {
  let app: Express;
  let fixture: TestFixture;

  const seedCorpus = (): void => {
    const specs = path.join(fixture.repoPath, '.truecourse', 'specs');
    fs.mkdirSync(specs, { recursive: true });
    fs.writeFileSync(
      path.join(specs, 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [
          { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
          { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] },
        ],
        areas: [
          {
            id: 'booking/appointments',
            product: 'booking',
            concern: 'appointments',
            docRefs: ['docs/v1.md', 'docs/v2.md'],
            overlaps: [
              {
                docs: ['docs/v1.md', 'docs/v2.md'],
                note: '24h vs 48h',
                sections: [
                  { doc: 'docs/v1.md', heading: 'Cancellation' },
                  { doc: 'docs/v2.md', heading: 'Cancellation policy' },
                ],
              },
            ],
          },
        ],
        relations: [],
        skippedDocs: [],
      }),
    );
  };

  const verdict = {
    docA: 'docs/v1.md',
    anchorA: 'Cancellation',
    docB: 'docs/v2.md',
    anchorB: 'Cancellation policy',
    verdict: 'a' as const,
  };

  beforeEach(async () => {
    fixture = await setupTestFixture();
    gitInit(fixture.repoPath);
    vi.mocked(curateInProcess).mockClear();
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    setBackgroundTaskRunner(null);
    await teardownTestFixture(fixture.project.slug);
  });

  it('POST records a verdict without re-curating (OSS ack), and GET /spec/corpus exposes it', async () => {
    seedCorpus();
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send(verdict)
      .expect(200);
    // OSS ack: the persisted verdicts only (no corpus), and no re-curate.
    expect(res.body.conflictResolutions).toHaveLength(1);
    expect(res.body.conflictResolutions[0]).toMatchObject({ docA: 'docs/v1.md', verdict: 'a' });
    expect(res.body.conflictResolutions[0].resolvedAt).toBeTruthy();
    expect(res.body.corpus).toBeUndefined();
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();

    // The corpus payload now carries the verdict so the client re-derives resolution.
    const corpus = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(corpus.body.conflictResolutions).toHaveLength(1);
  });

  it('DELETE removes the verdict by dispute identity (OSS ack)', async () => {
    seedCorpus();
    await request(app).post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`).send(verdict).expect(200);
    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send({ docA: 'docs/v1.md', anchorA: 'Cancellation', docB: 'docs/v2.md', anchorB: 'Cancellation policy' })
      .expect(200);
    expect(del.body.conflictResolutions).toEqual([]);
  });

  it('recording a verdict lights the decisionsPending staleness signal', async () => {
    seedCorpus();
    const before = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(before.body.decisionsPending).toBe(false);
    await request(app).post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`).send(verdict).expect(200);
    const after = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(after.body.decisionsPending).toBe(true);
  });

  it('400s on a missing/equal doc pair or a bad verdict', async () => {
    seedCorpus();
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send({ docA: 'docs/v1.md', anchorA: null, docB: 'docs/v1.md', anchorB: null, verdict: 'a' })
      .expect(400);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send({ docA: 'docs/v1.md', anchorA: null, docB: 'docs/v2.md', anchorB: null, verdict: 'bogus' })
      .expect(400);
  });
});
