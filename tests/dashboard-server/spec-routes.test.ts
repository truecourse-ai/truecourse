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

import { createApp } from '../../apps/dashboard/server/src/app';
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
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
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

  it('POST then DELETE /spec/includes round-trips a force-include', async () => {
    seedCorpus([]);
    const add = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    expect(add.body.manualIncludes).toContain('docs/v1.md');

    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    expect(del.body.manualIncludes).toEqual([]);
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
