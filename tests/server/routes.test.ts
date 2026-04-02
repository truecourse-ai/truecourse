import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../apps/server/src/db/schema';

// ---------------------------------------------------------------------------
// Mock the socket handlers so analysis doesn't crash on getIO()
// ---------------------------------------------------------------------------

vi.mock('../../apps/server/src/socket/handlers', () => ({
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
}));

// Import routes AFTER mocks are set up
import { errorHandler } from '../../apps/server/src/middleware/error';
import { initDatabase, closeDatabase } from '../../apps/server/src/config/database';
import reposRouter from '../../apps/server/src/routes/repos';
import analysisRouter from '../../apps/server/src/routes/analysis';
import flowsRouter from '../../apps/server/src/routes/flows';

// ---------------------------------------------------------------------------
// Fixture path
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, '../fixtures/sample-project');

// ---------------------------------------------------------------------------
// Database setup (same connection as the real server)
// ---------------------------------------------------------------------------

const DATABASE_URL =
  process.env.DATABASE_URL ||
  'postgresql://postgres:postgres@localhost:5435/truecourse_test';

const client = postgres(DATABASE_URL);
const db = drizzle(client, { schema });

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
// Helpers
// ---------------------------------------------------------------------------

/** Remove any repo with the fixture path from the database (cleanup from prior runs). */
async function cleanupFixtureRepo(): Promise<void> {
  const existing = await db
    .select()
    .from(schema.repos)
    .where(eq(schema.repos.path, FIXTURE_PATH));

  for (const repo of existing) {
    const repoAnalyses = await db
      .select()
      .from(schema.analyses)
      .where(eq(schema.analyses.repoId, repo.id));

    for (const analysis of repoAnalyses) {
      await db
        .delete(schema.violations)
        .where(eq(schema.violations.analysisId, analysis.id));
      await db
        .delete(schema.serviceDependencies)
        .where(eq(schema.serviceDependencies.analysisId, analysis.id));
      await db
        .delete(schema.services)
        .where(eq(schema.services.analysisId, analysis.id));
      // Flows and flow_steps cascade from analyses, but clean up explicitly just in case
      await db
        .delete(schema.flows)
        .where(eq(schema.flows.analysisId, analysis.id));
    }

    await db
      .delete(schema.analyses)
      .where(eq(schema.analyses.repoId, repo.id));

    // Delete conversations and messages
    const repoConversations = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.repoId, repo.id));

    for (const conv of repoConversations) {
      await db
        .delete(schema.messages)
        .where(eq(schema.messages.conversationId, conv.id));
    }

    await db
      .delete(schema.conversations)
      .where(eq(schema.conversations.repoId, repo.id));

    await db.delete(schema.repos).where(eq(schema.repos.id, repo.id));
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API routes (integration)', () => {
  const app = createTestApp();
  let createdRepoId: string;
  let fixtureHadGit: boolean;

  beforeAll(async () => {
    // Initialize the server's database connection (used by route handlers)
    initDatabase(DATABASE_URL);

    // Ensure the fixture directory is a git repo so simple-git calls work
    fixtureHadGit = existsSync(resolve(FIXTURE_PATH, '.git'));
    if (!fixtureHadGit) {
      execSync('git init && git add -A && git -c user.name="test" -c user.email="test@test.com" commit -m "init"', {
        cwd: FIXTURE_PATH,
        stdio: 'ignore',
      });
    }

    // Remove any leftover fixture repo from prior test runs
    await cleanupFixtureRepo();
  });

  afterAll(async () => {
    // Clean up any repos created during tests
    if (createdRepoId) {
      try {
        await cleanupFixtureRepo();
      } catch {
        // Repo may already have been deleted by the DELETE test
      }
    }

    // Remove .git from fixture if we created it
    if (!fixtureHadGit) {
      execSync('rm -rf .git', { cwd: FIXTURE_PATH, stdio: 'ignore' });
    }

    await closeDatabase();
    await client.end();
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
    expect(res.body.name).toBe('sample-project');
    expect(res.body.path).toBe(FIXTURE_PATH);
    createdRepoId = res.body.id;
  });

  // -----------------------------------------------------------------------
  // POST /api/repos — duplicate returns 200 (idempotent)
  // -----------------------------------------------------------------------

  it('POST /api/repos — duplicate path returns 200', async () => {
    const res = await request(app)
      .post('/api/repos')
      .send({ path: FIXTURE_PATH })
      .expect(200);

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
    expect(found.name).toBe('sample-project');
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id — returns repo with latest analysis (none yet)
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id — returns repo details', async () => {
    const res = await request(app)
      .get(`/api/repos/${createdRepoId}`)
      .expect(200);

    expect(res.body.id).toBe(createdRepoId);
    expect(res.body.name).toBe('sample-project');
    expect(res.body).toHaveProperty('branches');
    expect(res.body).toHaveProperty('defaultBranch');
    expect(res.body.latestAnalysis).toBeNull();
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
      .send({})
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
    const analysisRows = await db
      .select()
      .from(schema.analyses)
      .where(eq(schema.analyses.repoId, createdRepoId));

    expect(analysisRows.length).toBeGreaterThan(0);
    expect(analysisRows[0].repoId).toBe(createdRepoId);
  }, 90_000);

  // -----------------------------------------------------------------------
  // GET /api/repos/:id — returns repo with latest analysis (after analyze)
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id — includes latest analysis after analyze', async () => {
    const res = await request(app)
      .get(`/api/repos/${createdRepoId}`)
      .expect(200);

    expect(res.body.latestAnalysis).not.toBeNull();
    expect(res.body.latestAnalysis).toHaveProperty('id');
    expect(res.body.latestAnalysis).toHaveProperty('architecture');
    expect(res.body.latestAnalysis).toHaveProperty('services');
    expect(res.body.latestAnalysis.services.length).toBeGreaterThan(0);
    expect(res.body.latestAnalysis).toHaveProperty('dependencies');
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
  // GET /api/repos/:id/files?ref=working-tree — includes untracked files
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/files?ref=working-tree — includes untracked files', async () => {
    // Create an untracked file in the fixture
    const untrackedPath = resolve(FIXTURE_PATH, '_test_untracked.txt');
    require('fs').writeFileSync(untrackedPath, 'untracked content');

    try {
      // Default mode should NOT include the untracked file
      const defaultRes = await request(app)
        .get(`/api/repos/${createdRepoId}/files`)
        .expect(200);

      expect(defaultRes.body.files).not.toContain('_test_untracked.txt');

      // Working-tree mode SHOULD include the untracked file
      const wtRes = await request(app)
        .get(`/api/repos/${createdRepoId}/files?ref=working-tree`)
        .expect(200);

      expect(wtRes.body.files).toContain('_test_untracked.txt');
    } finally {
      require('fs').unlinkSync(untrackedPath);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/file-content — returns committed content by default
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/file-content — returns committed content by default', async () => {
    const res = await request(app)
      .get(`/api/repos/${createdRepoId}/file-content?path=package.json`)
      .expect(200);

    expect(res.body).toHaveProperty('content');
    expect(res.body).toHaveProperty('language', 'json');
    // Content should be valid JSON (the fixture package.json)
    expect(() => JSON.parse(res.body.content)).not.toThrow();
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/file-content?ref=working-tree — returns filesystem content
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/file-content?ref=working-tree — returns working tree content', async () => {
    const testFile = resolve(FIXTURE_PATH, '_test_wt_file.txt');
    require('fs').writeFileSync(testFile, 'working tree content here');

    try {
      // Default mode: new untracked file should still be readable (fallback)
      const defaultRes = await request(app)
        .get(`/api/repos/${createdRepoId}/file-content?path=_test_wt_file.txt`)
        .expect(200);

      expect(defaultRes.body.content).toBe('working tree content here');

      // Working-tree mode: should read from filesystem
      const wtRes = await request(app)
        .get(`/api/repos/${createdRepoId}/file-content?path=_test_wt_file.txt&ref=working-tree`)
        .expect(200);

      expect(wtRes.body.content).toBe('working tree content here');
    } finally {
      require('fs').unlinkSync(testFile);
    }
  });

  // -----------------------------------------------------------------------
  // GET /api/repos/:id/file-content — committed vs working tree difference
  // -----------------------------------------------------------------------

  it('GET /api/repos/:id/file-content — default returns committed, not working tree edits', async () => {
    const fs = require('fs');
    const targetFile = 'package.json';
    const fullPath = resolve(FIXTURE_PATH, targetFile);

    // Read the original committed content
    const committedRes = await request(app)
      .get(`/api/repos/${createdRepoId}/file-content?path=${targetFile}`)
      .expect(200);

    const originalContent = fs.readFileSync(fullPath, 'utf-8');

    // Modify the file on disk
    fs.writeFileSync(fullPath, originalContent + '\n// local edit');

    try {
      // Default mode should still return committed content (no local edit)
      const defaultRes = await request(app)
        .get(`/api/repos/${createdRepoId}/file-content?path=${targetFile}`)
        .expect(200);

      expect(defaultRes.body.content).not.toContain('// local edit');

      // Working-tree mode should include the local edit
      const wtRes = await request(app)
        .get(`/api/repos/${createdRepoId}/file-content?path=${targetFile}&ref=working-tree`)
        .expect(200);

      expect(wtRes.body.content).toContain('// local edit');
    } finally {
      // Restore original content
      fs.writeFileSync(fullPath, originalContent);
    }
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

  it('DELETE /api/repos/:id — removes repo, returns 204', async () => {
    await request(app)
      .delete(`/api/repos/${createdRepoId}`)
      .expect(204);

    // Verify repo is gone
    const rows = await db
      .select()
      .from(schema.repos)
      .where(eq(schema.repos.id, createdRepoId));

    expect(rows).toHaveLength(0);

    // Verify cascaded data is also gone
    const analysisRows = await db
      .select()
      .from(schema.analyses)
      .where(eq(schema.analyses.repoId, createdRepoId));

    expect(analysisRows).toHaveLength(0);

    // Mark as deleted so afterAll cleanup doesn't try again
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
