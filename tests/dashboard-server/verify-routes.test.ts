import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../apps/dashboard/server/src/app';
import {
  appendVerifyHistory,
  writeVerifyRun,
} from '../../packages/core/src/lib/verify-store';
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-db';

/**
 * The verify drift-trend chart reads `GET /verify/history`, backed by
 * `verifier/history.json` (written each run via `appendVerifyHistory`).
 * These tests assert the route's HTTP shape: empty default, and the
 * accumulated per-run summaries in append order.
 */
describe('GET /api/repos/:id/verify/history', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns the empty default when no run has been recorded', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/verify/history`)
      .expect(200);
    expect(res.body).toEqual({ runs: [] });
  });

  it('returns the recorded per-run summaries in append order', async () => {
    appendVerifyHistory(fixture.repoPath, {
      id: 'run-1',
      filename: '2026-01-01T00:00:00.000Z_run-1.json',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commitHash: null,
      artifactCount: 10,
      driftCount: 5,
      bySeverity: { info: 0, low: 1, medium: 2, high: 1, critical: 1 },
    });
    appendVerifyHistory(fixture.repoPath, {
      id: 'run-2',
      filename: '2026-01-02T00:00:00.000Z_run-2.json',
      verifiedAt: '2026-01-02T00:00:00.000Z',
      branch: 'main',
      commitHash: null,
      artifactCount: 10,
      driftCount: 2,
      bySeverity: { info: 0, low: 0, medium: 1, high: 1, critical: 0 },
    });

    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/verify/history`)
      .expect(200);

    expect(res.body.runs).toHaveLength(2);
    expect(res.body.runs.map((r: { id: string }) => r.id)).toEqual(['run-1', 'run-2']);
    expect(res.body.runs[0].driftCount).toBe(5);
    expect(res.body.runs[1].driftCount).toBe(2);
  });
});

describe('GET /api/repos/:id/verify/runs/:runId', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns a past run snapshot as verify state', async () => {
    const { filename } = writeVerifyRun(fixture.repoPath, {
      id: 'run-abc',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commitHash: 'deadbeef',
      contractsDir: '.truecourse/contracts',
      codeDir: '.',
      artifactCount: 7,
      extractedOperationCount: 3,
      drifts: [],
      resolverErrors: [],
      unresolvedRefs: ['SomeRef'],
    });
    appendVerifyHistory(fixture.repoPath, {
      id: 'run-abc',
      filename,
      verifiedAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commitHash: 'deadbeef',
      artifactCount: 7,
      driftCount: 0,
      bySeverity: { info: 0, low: 0, medium: 0, high: 0, critical: 0 },
    });

    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/verify/runs/run-abc`)
      .expect(200);

    expect(res.body).toMatchObject({
      verifiedAt: '2026-01-01T00:00:00.000Z',
      artifactCount: 7,
      extractedOperationCount: 3,
      drifts: [],
      unresolvedRefs: ['SomeRef'],
    });
  });

  it('returns 404 for an unknown run id', async () => {
    await request(app)
      .get(`/api/repos/${fixture.project.slug}/verify/runs/does-not-exist`)
      .expect(404);
  });
});

describe('DELETE /api/repos/:id/verify/runs/:runId', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('removes the run from history and 404s an unknown id', async () => {
    const { filename } = writeVerifyRun(fixture.repoPath, {
      id: 'run-del',
      verifiedAt: '2026-01-03T00:00:00.000Z',
      branch: 'main',
      commitHash: null,
      contractsDir: '.truecourse/contracts',
      codeDir: '.',
      artifactCount: 2,
      extractedOperationCount: 1,
      drifts: [],
      resolverErrors: [],
      unresolvedRefs: [],
    });
    appendVerifyHistory(fixture.repoPath, {
      id: 'run-del',
      filename,
      verifiedAt: '2026-01-03T00:00:00.000Z',
      branch: 'main',
      commitHash: null,
      artifactCount: 2,
      driftCount: 0,
      bySeverity: { info: 0, low: 0, medium: 0, high: 0, critical: 0 },
    });

    await request(app)
      .delete(`/api/repos/${fixture.project.slug}/verify/runs/run-del`)
      .expect(200);

    const history = await request(app)
      .get(`/api/repos/${fixture.project.slug}/verify/history`)
      .expect(200);
    expect(history.body.runs).toHaveLength(0);

    await request(app)
      .delete(`/api/repos/${fixture.project.slug}/verify/runs/run-del`)
      .expect(404);
  });
});
