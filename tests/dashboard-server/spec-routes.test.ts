import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import request from 'supertest';
import express, { type Express, type Request } from 'express';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { AuthUser } from '@truecourse/shared';
import { PgSpecStore } from '../../ee/packages/data-store/src/index';
import { setSpecStore, resetSpecStore } from '@truecourse/core/lib/spec-store';
import { setBackgroundTaskRunner } from '@truecourse/core/lib/background-tasks';
import specRouter from '../../apps/dashboard/server/src/routes/spec';

/** `spec scan` requires a git repo (like analyze) — init the fixture so the route guard passes. */
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
 * Spec route tests use the multi-doc fixture so the consolidator has
 * real input. Block extraction is mocked at the package boundary —
 * we vi.spyOn `consolidate` and inject canned merge results. The
 * tests assert the HTTP shape of each route, not the engine itself
 * (engine has its own suite under tests/spec-consolidator/).
 */

const FIXTURE_ROOT = path.resolve(__dirname, '../fixtures/sample-multi-doc-spec');

describe('GET /api/repos/:id/spec/scan', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    // Empty repo — no markdown docs. consolidate() walks zero
    // candidates, returns an empty merge. We're testing the route
    // shape, not the engine; the engine has its own suite.
    fixture = await setupTestFixture();
    gitInit(fixture.repoPath);
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns the expected shape on an empty repo', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/scan`)
      .expect(200);

    expect(res.body).toMatchObject({
      docsScanned: 0,
      blocksAttempted: 0,
      claimsExtracted: 0,
      resolved: 0,
      decided: 0,
      openConflicts: [],
      decidedConflicts: [],
    });
  });
});

describe('GET /api/repos/:id/spec/scan (not a git repo)', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture(); // intentionally NOT git-initialized
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns 400 — the spec→verify track requires git, like analyze', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/scan`)
      .expect(400);
    expect(res.body.error).toMatch(/not a git repository/i);
  });
});

describe('POST /api/repos/:id/spec/decisions', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('persists a single decision into decisions.json', async () => {
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/decisions`)
      .send({
        conflictId: 'conflict-1',
        resolution: { kind: 'pick', candidateIndex: 1 },
        candidateFingerprint: 'fp-1',
      })
      .expect(200);

    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.decisions[0].conflictId).toBe('conflict-1');

    const decisionsFile = path.join(
      fixture.repoPath,
      '.truecourse',
      'specs',
      'decisions.json',
    );
    expect(fs.existsSync(decisionsFile)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(decisionsFile, 'utf-8'));
    expect(onDisk.decisions[0].conflictId).toBe('conflict-1');
  });

  it('replaces an existing decision for the same conflictId (no duplicates)', async () => {
    const url = `/api/repos/${fixture.project.slug}/spec/decisions`;
    await request(app)
      .post(url)
      .send({
        conflictId: 'c1',
        resolution: { kind: 'pick', candidateIndex: 0 },
        candidateFingerprint: 'fp',
      })
      .expect(200);
    const res = await request(app)
      .post(url)
      .send({
        conflictId: 'c1',
        resolution: { kind: 'pick', candidateIndex: 1 },
        candidateFingerprint: 'fp',
      })
      .expect(200);
    expect(res.body.decisions).toHaveLength(1);
    expect(res.body.decisions[0].resolution.candidateIndex).toBe(1);
  });

  it('accepts a custom free-text resolution (Q11)', async () => {
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/decisions`)
      .send({
        conflictId: 'c-custom',
        resolution: { kind: 'custom', content: 'Bearer JWT (RS256)' },
        candidateFingerprint: 'fp',
      })
      .expect(200);
    expect(res.body.decisions[0].resolution.kind).toBe('custom');
  });

  it('rejects requests missing required fields', async () => {
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/decisions`)
      .send({ conflictId: 'c1' })
      .expect(400);
  });
});

describe('POST /api/repos/:id/spec/decisions/batch', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('mode="all-defaults" returns added=0 on an empty repo (no conflicts to resolve)', async () => {
    // Empty repo: consolidate() finds no docs, no conflicts. The
    // batch endpoint should still return cleanly.
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/decisions/batch`)
      .send({ mode: 'all-defaults' })
      .expect(200);
    expect(res.body.added).toBe(0);
    expect(res.body.decisions.decisions).toEqual([]);
  });

  it('rejects unknown modes', async () => {
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/decisions/batch`)
      .send({ mode: 'pick-newest-on-tuesdays' })
      .expect(400);
  });
});

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
      .get(`/api/repos/${fixture.project.slug}/spec/decisions`)
      .expect(200);
    expect(res.body).toEqual({
      version: 1,
      decisions: [],
      manualChains: [],
      manualIncludes: [],
      relations: [],
      manualAreas: [],
    });
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
});

describe('POST /contracts/generate (corpus-vs-claims branch)', () => {
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

  it('uses the CORPUS path when a corpus.json exists (empty corpus → 0 written, not skipped)', async () => {
    const specs = path.join(fixture.repoPath, '.truecourse', 'specs');
    fs.mkdirSync(specs, { recursive: true });
    fs.writeFileSync(
      path.join(specs, 'corpus.json'),
      JSON.stringify({ version: 3, generatedAt: '2026-01-01T00:00:00Z', docs: [], areas: [], relations: [] }),
    );
    const res = await request(app).post(`/api/repos/${fixture.project.slug}/contracts/generate`).expect(200);
    // Corpus branch ran (generated, 0 written) rather than the claims "skipped — no canonical spec".
    expect(res.body.il).toMatchObject({ written: 0 });
    expect(res.body.il.skipped).toBeUndefined();
  });

  it('falls back to the CLAIMS path when there is no corpus (skips with no canonical spec)', async () => {
    const res = await request(app).post(`/api/repos/${fixture.project.slug}/contracts/generate`).expect(200);
    expect(res.body.il.skipped).toBeTruthy();
  });
});

describe('POST /spec/decisions — hosted (enterprise) defers the contract refresh to the queue', () => {
  let app: Express;
  let fixture: TestFixture;
  let client: PGlite;
  let enqueue: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    // Hosted store → specsMaterializeInPlace() is false → the refresh path runs.
    setSpecStore(new PgSpecStore(db as unknown as EeDb));
    enqueue = vi.fn().mockResolvedValue(undefined);
    setBackgroundTaskRunner(enqueue);

    // Mount the spec router with an injected enterprise user (the org scopes the job).
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as Request & { eeUser?: AuthUser }).eeUser = {
        id: 'u1',
        email: 'u@acme.test',
        organizationId: 'org_A',
      };
      next();
    });
    app.use('/api/repos', specRouter);
  });

  afterEach(async () => {
    setBackgroundTaskRunner(null);
    resetSpecStore();
    await client.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('enqueues a repo.contracts task (off the request path) rather than regenerating inline', async () => {
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/decisions`)
      .send({ conflictId: 'c1', resolution: { kind: 'pick', candidateIndex: 0 }, candidateFingerprint: 'fp' })
      .expect(200);

    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith({
      type: 'repo.contracts',
      workspaceOrgId: 'org_A',
      repoKey: fixture.project.path,
    });
  });

  it('accept-all-defaults also enqueues the refresh (not inline)', async () => {
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/decisions/batch`)
      .send({ mode: 'all-defaults' })
      .expect(200);

    expect(enqueue).toHaveBeenCalledWith({
      type: 'repo.contracts',
      workspaceOrgId: 'org_A',
      repoKey: fixture.project.path,
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClaim(file: string): any {
  return {
    id: `claim-${file}`,
    topic: 'auth',
    subject: 'auth scheme',
    content: { scheme: 'whatever' },
    provenance: { file, line: 1, quote: 'q' },
    metadata: { docKind: 'prd', lastTouched: '2026-01-01T00:00:00Z' },
  };
}

function fakeConflict(id: string, defaultPick: number): any {
  return {
    id,
    topic: 'auth',
    subject: `subject-${id}`,
    candidates: [
      { index: 0, weight: 'oldest', claim: makeClaim('a.md') },
      { index: 1, weight: 'newest', claim: makeClaim('b.md') },
    ],
    defaultPick,
  };
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, entry.name);
    const b = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}
