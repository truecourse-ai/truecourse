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
  return { ...actual, curateInProcess: vi.fn(async () => ({ noChanges: false })) };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import { curateInProcess } from '@truecourse/core/commands/spec-in-process';
import {
  setBackgroundTaskRunner,
  type BackgroundTask,
} from '@truecourse/core/lib/background-tasks';
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-db';

/**
 * Spec route tests assert the HTTP shape of the corpus routes + the
 * corpus-only contracts/generate route. The curate/generate engine has its own
 * suite under tests/spec-consolidator/ and tests/contract-extractor/.
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

  it('GET /spec/corpus → the corpus + user relations', async () => {
    seedCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(res.body.corpus.areas).toHaveLength(1);
    expect(res.body.corpus.areas[0].overlaps).toHaveLength(1);
    expect(res.body.userRelations).toEqual([]);
  });

  it('GET /spec/doc → the markdown content; rejects traversal', async () => {
    seedCorpus([]);
    const ok = await request(app).get(`/api/repos/${fixture.project.slug}/spec/doc`).query({ ref: 'docs/v2.md' }).expect(200);
    expect(ok.body.content).toContain('48h');
    await request(app).get(`/api/repos/${fixture.project.slug}/spec/doc`).query({ ref: '../../etc/passwd' }).expect(400);
  });

  it('POST then DELETE /spec/relations round-trips a user relation', async () => {
    seedCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    const add = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments' })
      .expect(200);
    expect(add.body.relations).toHaveLength(1);
    expect(add.body.relations[0]).toMatchObject({ type: 'precedence', detectedFrom: 'manual' });

    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ older: 'docs/v1.md', newer: 'docs/v2.md' })
      .expect(200);
    expect(del.body.relations).toEqual([]);
  });

  it('POST /spec/relations rejects a bad type', async () => {
    seedCorpus([]);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ type: 'bogus', older: 'a.md', newer: 'b.md' })
      .expect(400);
  });

  it('POST then DELETE /spec/includes round-trips a force-include + re-curates', async () => {
    seedCorpus([]);
    const add = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    expect(add.body.manualIncludes).toContain('docs/v1.md');
    // The route drives the recheck server-side — not the client.
    expect(vi.mocked(curateInProcess)).toHaveBeenCalledTimes(1);

    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    expect(del.body.manualIncludes).toEqual([]);
    expect(vi.mocked(curateInProcess)).toHaveBeenCalledTimes(2);
  });

  it('POST then DELETE /spec/excludes round-trips a force-exclude + re-curates', async () => {
    seedCorpus([]);
    const add = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(add.body.manualExcludes).toContain('docs/v2.md');
    expect(vi.mocked(curateInProcess)).toHaveBeenCalledTimes(1);

    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(del.body.manualExcludes).toEqual([]);
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

  // Resolving a conflict must regenerate contracts. The shared route defers to the
  // background-task seam (EE runner installed → enqueues repo.contracts; OSS → none).
  it('POST /spec/relations enqueues repo.contracts when a runner is installed', async () => {
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments' })
      .expect(200);
    expect(tasks).toEqual([{ type: 'repo.contracts', repoKey: fixture.repoPath }]);
  });

  it('DELETE /spec/relations also enqueues repo.contracts', async () => {
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ older: 'docs/v1.md', newer: 'docs/v2.md' })
      .expect(200);
    expect(tasks).toEqual([{ type: 'repo.contracts', repoKey: fixture.repoPath }]);
  });

  it('POST /spec/relations is a no-op (no throw) when no runner is installed (OSS)', async () => {
    setBackgroundTaskRunner(null);
    seedCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md', scope: 'booking/appointments' })
      .expect(200);
  });
});

describe('POST /contracts/generate (corpus-only)', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    gitInit(fixture.repoPath);
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('generates from corpus.json (empty corpus → 0 written, not skipped)', async () => {
    const specs = path.join(fixture.repoPath, '.truecourse', 'specs');
    fs.mkdirSync(specs, { recursive: true });
    fs.writeFileSync(
      path.join(specs, 'corpus.json'),
      JSON.stringify({ version: 3, generatedAt: '2026-01-01T00:00:00Z', docs: [], areas: [], relations: [] }),
    );
    const res = await request(app).post(`/api/repos/${fixture.project.slug}/contracts/generate`).expect(200);
    expect(res.body.il).toMatchObject({ written: 0 });
    expect(res.body.il.skipped).toBeUndefined();
  });

  it('skips with "no corpus" when there is no corpus.json', async () => {
    const res = await request(app).post(`/api/repos/${fixture.project.slug}/contracts/generate`).expect(200);
    expect(res.body.il.skipped).toBeTruthy();
  });
});
