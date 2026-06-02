import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import request from 'supertest';
import type { Express } from 'express';

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
    expect(res.body).toEqual({ version: 1, decisions: [], manualChains: [], manualIncludes: [] });
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
