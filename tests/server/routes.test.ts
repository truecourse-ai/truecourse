import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import * as schema from '../../apps/server/src/db/schema';
import { setupTestDb, teardownTestDb, type TestDb } from '../helpers/test-db';

// ---------------------------------------------------------------------------
// Mock the socket handlers so analysis doesn't crash on getIO()
// ---------------------------------------------------------------------------

vi.mock('../../apps/server/src/socket/handlers', async () => {
  const actual = await vi.importActual('../../apps/server/src/socket/handlers');
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitFilesChanged: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    emitCodeReviewProgress: vi.fn(),
    emitCodeReviewReady: vi.fn(),
    StepTracker: class StepTracker {
      constructor() {}
      start() {}
      done() {}
      error() {}
      detail() {}
    },
  };
});

// Import routes AFTER mocks are set up
import { errorHandler } from '../../apps/server/src/middleware/error';
import reposRouter from '../../apps/server/src/routes/repos';
import analysisRouter from '../../apps/server/src/routes/analysis';
import flowsRouter from '../../apps/server/src/routes/flows';

// ---------------------------------------------------------------------------
// Fixture path
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../fixtures/sample-js-project-negative');

// ---------------------------------------------------------------------------
// Shared PGlite instance (created in beforeAll via setupTestDb)
// ---------------------------------------------------------------------------

let db: TestDb;

// ---------------------------------------------------------------------------
// Build a standalone Express app for testing (avoids socket.io and server.listen)
// ---------------------------------------------------------------------------

function createTestApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use('/api/repos', reposRouter);
  app.use('/api/repos', analysisRouter);
  app.use('/api/repos', flowsRouter);
  app.use(errorHandler);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API routes (integration)', () => {
  const app = createTestApp();
  let createdRepoId: string;

  beforeAll(async () => {
    ({ db } = await setupTestDb(FIXTURE_PATH));
  });

  afterAll(async () => {
    await teardownTestDb();
  });

  // -----------------------------------------------------------------------
  // POST /api/repos — creates repo, returns 201
  // -----------------------------------------------------------------------

  it('POST /api/repos — creates repo, returns 201', async () => {
    const res = await request(app)
      .post('/api/repos')
      .send({ path: FIXTURE_PATH })
      .expect(201);

    expect(res.body).toHaveProperty('id');
    expect(res.body.name).toBe('sample-js-project-negative');
    expect(res.body.path).toBe(FIXTURE_PATH);
    createdRepoId = res.body.id;
  });

  // -----------------------------------------------------------------------
  // POST /api/repos — duplicate returns 201 with the same slug (idempotent)
  // -----------------------------------------------------------------------

  it('POST /api/repos — duplicate path returns the same slug', async () => {
    const res = await request(app)
      .post('/api/repos')
      .send({ path: FIXTURE_PATH })
      .expect(201);

    expect(res.body.id).toBe(createdRepoId);
  });

  // -----------------------------------------------------------------------
  // POST /api/repos — rejects invalid path, returns 400
  // -----------------------------------------------------------------------

  it('POST /api/repos — rejects invalid path, returns 400', async () => {
    const res = await request(app)
      .post('/api/repos')
      .send({ path: '/nonexistent/path/that/does/not/exist' })
      .expect(400);

    expect(res.body).toHaveProperty('error');
  });

  // -----------------------------------------------------------------------
  // POST /api/repos — rejects missing path, returns 400
  // -----------------------------------------------------------------------

  it('POST /api/repos — rejects missing path, returns 400', async () => {
    const res = await request(app).post('/api/repos').send({}).expect(400);

    expect(res.body).toHaveProperty('error');
  });

  // -----------------------------------------------------------------------
  // GET /api/repos — lists repos
  // -----------------------------------------------------------------------

  it('GET /api/repos — lists repos', async () => {
    const res = await request(app).get('/api/repos').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    const found = res.body.find(
      (r: { id: string }) => r.id === createdRepoId
    );
    expect(found).toBeDefined();
    expect(found.name).toBe('sample-js-project-negative');
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id — returns repo with latest analysis (none yet)
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id — returns repo details', async () => {
    const res = await request(app)
      .get(`/api/repos/${createdRepoId}`)
      .expect(200);

    expect(res.body.id).toBe(createdRepoId);
    expect(res.body.name).toBe('sample-js-project-negative');
    expect(res.body).toHaveProperty('branches');
    expect(res.body).toHaveProperty('defaultBranch');
    expect(res.body.lastAnalyzed).toBeNull();
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id — returns 404 for nonexistent repo
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id — returns 404 for nonexistent repo', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await request(app).get(`/api/repos/${fakeId}`).expect(404);
  });

  // -----------------------------------------------------------------------
  // POST /api/repos/:id/analyze — triggers analysis, returns 202
  // -----------------------------------------------------------------------

  it('POST /api/repos/:id/analyze — triggers analysis, returns 202', async () => {
    const res = await request(app)
      .post(`/api/repos/${createdRepoId}/analyze`)
      .send({ skipGit: true })
      .expect(202);

    expect(res.body.message).toBe('Analysis started');
    expect(res.body.repoId).toBe(createdRepoId);

    // Wait for background analysis to fully complete.
    // Poll until emitAnalysisComplete has been called (mocked).
    const { emitAnalysisComplete } = await import('../../apps/server/src/socket/handlers');
    const maxWait = 60_000;
    const pollInterval = 500;
    const start = Date.now();

    while (Date.now() - start < maxWait) {
      if ((emitAnalysisComplete as any).mock.calls.length > 0) {
        // Allow DB writes to flush before subsequent tests read
        await new Promise((r) => setTimeout(r, 200));
        break;
      }
      await new Promise((r) => setTimeout(r, pollInterval));
    }

    // Verify analysis was actually saved
    const analysisRows = await db.select().from(schema.analyses);
    expect(analysisRows.length).toBeGreaterThan(0);
  }, 90_000);

  // -----------------------------------------------------------------------
  // GET /api/repos/:id — surfaces lastAnalyzed timestamp after analyze
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id — surfaces lastAnalyzed timestamp after analyze', async () => {
    const res = await request(app)
      .get(`/api/repos/${createdRepoId}`)
      .expect(200);

    expect(res.body.lastAnalyzed).not.toBeNull();
    expect(typeof res.body.lastAnalyzed).toBe('string');
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/graph — returns graph data after analysis
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/graph — returns graph data after analysis', async () => {
    const res = await request(app)
      .get(`/api/repos/${createdRepoId}/graph`)
      .expect(200);

    expect(res.body).toHaveProperty('nodes');
    expect(res.body).toHaveProperty('edges');
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(res.body.nodes.length).toBeGreaterThan(0);

    // Each node should have expected fields
    const firstNode = res.body.nodes[0];
    expect(firstNode).toHaveProperty('id');
    expect(firstNode).toHaveProperty('type');
    expect(firstNode).toHaveProperty('position');
    expect(firstNode).toHaveProperty('data');
    expect(firstNode.data).toHaveProperty('label');
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/flows — returns flows after analysis
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/flows — returns flow list with severities', async () => {
    const res = await request(app)
      .get(`/api/repos/${createdRepoId}/flows`)
      .expect(200);

    expect(res.body).toHaveProperty('flows');
    expect(res.body).toHaveProperty('severities');
    expect(Array.isArray(res.body.flows)).toBe(true);
    expect(res.body.flows.length).toBeGreaterThan(0);

    const firstFlow = res.body.flows[0];
    expect(firstFlow).toHaveProperty('id');
    expect(firstFlow).toHaveProperty('name');
    expect(firstFlow).toHaveProperty('trigger');
    expect(firstFlow).toHaveProperty('stepCount');
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/flows/:flowId — returns flow with steps
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/flows/:flowId — returns flow with steps', async () => {
    // First get the flow list
    const listRes = await request(app)
      .get(`/api/repos/${createdRepoId}/flows`)
      .expect(200);

    const flowId = listRes.body.flows[0].id;
    const res = await request(app)
      .get(`/api/repos/${createdRepoId}/flows/${flowId}`)
      .expect(200);

    expect(res.body).toHaveProperty('id', flowId);
    expect(res.body).toHaveProperty('name');
    expect(res.body).toHaveProperty('steps');
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(res.body.steps.length).toBeGreaterThan(0);

    // Steps should have expected fields
    const step = res.body.steps[0];
    expect(step).toHaveProperty('stepOrder');
    expect(step).toHaveProperty('sourceService');
    expect(step).toHaveProperty('targetService');
    expect(step).toHaveProperty('stepType');
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/flows/:flowId — 404 for nonexistent flow
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/flows/:flowId — returns 404 for nonexistent flow', async () => {
    const fakeFlowId = '00000000-0000-0000-0000-000000000000';
    await request(app)
      .get(`/api/repos/${createdRepoId}/flows/${fakeFlowId}`)
      .expect(404);
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/files — returns tracked files (default)
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/files — returns tracked files', async () => {
    const res = await request(app)
      .get(`/api/repos/${createdRepoId}/files`)
      .expect(200);

    expect(res.body).toHaveProperty('root');
    expect(res.body).toHaveProperty('files');
    expect(Array.isArray(res.body.files)).toBe(true);
    expect(res.body.files.length).toBeGreaterThan(0);
    // Should contain a known fixture file
    expect(res.body.files.some((f: string) => f.includes('package.json'))).toBe(true);
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/file-content — returns content
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/file-content — returns file content', async () => {
    const res = await request(app)
      .get(`/api/repos/${createdRepoId}/file-content?path=package.json`)
      .expect(200);

    expect(res.body).toHaveProperty('content');
    expect(res.body).toHaveProperty('language', 'json');
    // Content should be valid JSON (the fixture package.json)
    expect(() => JSON.parse(res.body.content)).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/file-content — missing path returns 400
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/file-content — missing path returns 400', async () => {
    await request(app)
      .get(`/api/repos/${createdRepoId}/file-content`)
      .expect(400);
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/file-content — nonexistent file returns 404
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/file-content — nonexistent file returns 404', async () => {
    await request(app)
      .get(`/api/repos/${createdRepoId}/file-content?path=does-not-exist.xyz&ref=working-tree`)
      .expect(404);
  });

  // -----------------------------------------------------------------------
  // DELETE /api/repos/:id — removes repo and cascades
  // -----------------------------------------------------------------------

  it('DELETE /api/repos/:id — unregisters the project, returns 204', async () => {
    await request(app)
      .delete(`/api/repos/${createdRepoId}`)
      .expect(204);

    // Verify it's gone from the registry (project data on disk is untouched).
    const listRes = await request(app).get('/api/repos').expect(200);
    expect(listRes.body.find((r: { id: string }) => r.id === createdRepoId)).toBeUndefined();

    createdRepoId = '';
  });

  // -----------------------------------------------------------------------
  // DELETE /api/repos/:id — 404 for already-deleted repo
  // -----------------------------------------------------------------------

  it('DELETE /api/repos/:id — returns 404 for nonexistent repo', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000000';
    await request(app).delete(`/api/repos/${fakeId}`).expect(404);
  });
});
