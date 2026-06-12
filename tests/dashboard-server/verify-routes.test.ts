import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../../apps/dashboard/server/src/app';
import {
  appendVerifyHistory,
  writeVerifyRun,
} from '../../packages/core/src/lib/verify-store';
import { setDefaultTransport } from '@truecourse/shared/llm';
import { setKvCacheStore, resetKvCacheStore, type KvCacheStore } from '@truecourse/llm';
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-db';

/** A Map-backed KvCacheStore so enrichment caching never touches disk in tests. */
class MemoryCacheStore implements KvCacheStore {
  private m = new Map<string, unknown>();
  private k(scope: string, name: string, key: string): string {
    return `${scope}::${name}::${key}`;
  }
  async get(scope: string, name: string, key: string): Promise<unknown | null> {
    const v = this.m.get(this.k(scope, name, key));
    return v === undefined ? null : v;
  }
  async set(scope: string, name: string, key: string, value: unknown): Promise<void> {
    this.m.set(this.k(scope, name, key), value);
  }
}

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
    await appendVerifyHistory(fixture.repoPath, {
      id: 'run-1',
      filename: '2026-01-01T00:00:00.000Z_run-1.json',
      verifiedAt: '2026-01-01T00:00:00.000Z',
      branch: 'main',
      commitHash: null,
      artifactCount: 10,
      driftCount: 5,
      bySeverity: { info: 0, low: 1, medium: 2, high: 1, critical: 1 },
    });
    await appendVerifyHistory(fixture.repoPath, {
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

describe('GET /api/repos/:id/verify/diff', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('404s when no working-tree diff has been computed', async () => {
    await request(app).get(`/api/repos/${fixture.project.slug}/verify/diff`).expect(404);
  });

  it('404s for a ref with no stored snapshot', async () => {
    await request(app).get(`/api/repos/${fixture.project.slug}/verify/diff?ref=deadbeef`).expect(404);
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
    const { filename } = await writeVerifyRun(fixture.repoPath, {
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
    await appendVerifyHistory(fixture.repoPath, {
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
    const { filename } = await writeVerifyRun(fixture.repoPath, {
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
    await appendVerifyHistory(fixture.repoPath, {
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

/**
 * The dashboard drift detail POSTs a drift's content to get readable prose.
 * The endpoint must degrade gracefully: 204 when no LLM transport is
 * configured (the client then keeps the structured view), 400 on a malformed
 * body, and 200 with the parsed `{ specReadable, codeReadable, summary }` when
 * a transport returns valid JSON. It must never 500 on a missing transport.
 */
describe('POST /api/repos/:id/verify/drift/enrich', () => {
  let app: Express;
  let fixture: TestFixture;

  const validDrift = {
    artifactRef: { type: 'Operation', identity: 'POST /api/orders' },
    obligationKey: 'response.201.headers.location',
    message: 'response 201 missing required header Location',
    severity: 'high',
    specSide: 'headers: { Location: string }',
    codeSide: 'res.status(201).json(order)',
  };

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
    setKvCacheStore(new MemoryCacheStore());
  });

  afterEach(async () => {
    setDefaultTransport(undefined);
    resetKvCacheStore();
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns 204 (no body) when no LLM transport is configured', async () => {
    // No transport set → enrichDrift returns null → 204, never 500.
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/verify/drift/enrich`)
      .send(validDrift)
      .expect(204);
    expect(res.body).toEqual({});
  });

  it('returns 400 for a malformed drift payload', async () => {
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/verify/drift/enrich`)
      .send({ message: 'no artifactRef or obligationKey' })
      .expect(400);
  });

  it('returns the parsed enrichment when a transport yields valid JSON', async () => {
    const enriched = {
      specReadable: 'The spec requires POST /api/orders to return a Location header on 201.',
      codeReadable: 'The code returns 201 with the order body but sets no Location header.',
      summary: 'Spec requires a Location header on the 201 response, but the code omits it.',
    };
    setDefaultTransport(async () => JSON.stringify(enriched));

    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/verify/drift/enrich`)
      .send(validDrift)
      .expect(200);

    expect(res.body).toEqual(enriched);
  });
});
