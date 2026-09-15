import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';

import { createTestApp, TEST_ORG } from '../helpers/test-app';
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-fixture';
import { getProjectBySlug } from '../../packages/core/src/config/registry';
import { guardLatestPath, workTreeDir } from '@truecourse/shared/work-tree';
import { installWorkTreeGuardStore, resetGuardStore } from '../helpers/work-tree-guard-store';

describe('repository routes', () => {
  let fixture: TestFixture;
  let app: Express;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    installWorkTreeGuardStore();
    app = createTestApp();
  });

  afterEach(async () => {
    resetGuardStore();
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET /api/repos lists the registered project', async () => {
    const res = await request(app).get('/api/repos').expect(200);
    const match = (res.body as Array<{ id: string }>).find((r) => r.id === fixture.project.slug);
    expect(match).toBeDefined();
  });

  it('GET /api/repos carries latestEvent from the per-repo stores', async () => {
    const guardLatest = {
      run: {
        runId: 'r1',
        ranAt: '2026-05-01T00:00:00.000Z',
        branch: 'main',
        commit: 'abc',
        recipeFingerprint: 'sha256:r',
        scenarioFormat: 2,
      },
      summary: { total: 0, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 },
      scenarios: [],
      sections: [],
    };
    const guardFile = guardLatestPath(fixture.repoPath);
    fs.mkdirSync(path.dirname(guardFile), { recursive: true });
    fs.writeFileSync(guardFile, JSON.stringify(guardLatest));

    const res = await request(app).get('/api/repos').expect(200);
    const match = (res.body as Array<{ id: string; latestEvent: { kind: string; at: string } | null }>)
      .find((r) => r.id === fixture.project.slug);
    expect(match!.latestEvent).toEqual({ kind: 'guarded', at: '2026-05-01T00:00:00.000Z' });
  });

  it('GET /api/repos/:unknown returns 404 via projectResolver', async () => {
    await request(app).get('/api/repos/no-such-slug/guard/flows').expect(404);
  });

  it('POST /api/repos no longer registers local paths', async () => {
    const res = await request(app)
      .post('/api/repos')
      .send({ path: fixture.repoPath });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect((await request(app).get('/api/repos')).body).toHaveLength(1);
  });

  it('DELETE /api/repos/:id 204 + disconnects without touching the tree', async () => {
    const tcDir = workTreeDir(fixture.repoPath);
    fs.mkdirSync(tcDir, { recursive: true });

    await request(app).delete(`/api/repos/${fixture.project.slug}`).expect(204);

    // The link (and with it the derived registry entry) is gone; the repo's
    // own tree is not the server's to delete — durable state lives in the DB.
    expect(await getProjectBySlug(TEST_ORG, fixture.project.slug)).toBeNull();
    expect(fs.existsSync(tcDir)).toBe(true);
  });
});
