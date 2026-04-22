import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../apps/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/server/src/socket/handlers')>();
  class NoopTracker {
    start() {}
    done() {}
    error() {}
    detail() {}
  }
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitFilesChanged: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    createSocketTracker: () => new NoopTracker(),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
  };
});

import { createApp } from '../../apps/server/src/app';
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-db';
import {
  writeLatest,
  writeAnalysis,
  appendHistory,
  writeDiff,
  clearLatestCache,
} from '../../apps/server/src/lib/analysis-store';
import {
  setLastAnalyzed,
  getProjectBySlug,
} from '../../apps/server/src/config/registry';
import { getRepoTruecourseDir } from '../../apps/server/src/config/paths';
import type {
  AnalysisSnapshot,
  DiffSnapshot,
  Graph,
  HistoryEntry,
  LatestSnapshot,
  ViolationRecord,
  ViolationWithNames,
} from '../../apps/server/src/types/snapshot';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGraph(): Graph {
  const serviceId = randomUUID();
  const layerId = randomUUID();
  const moduleId = randomUUID();
  const methodId = randomUUID();
  const dbId = randomUUID();

  return {
    services: [
      {
        id: serviceId,
        name: 'api',
        rootPath: 'services/api',
        type: 'api-server',
        framework: 'express',
        fileCount: 5,
        description: null,
        layerSummary: null,
      },
    ],
    serviceDependencies: [],
    layers: [
      {
        id: layerId,
        serviceId,
        serviceName: 'api',
        layer: 'service',
        fileCount: 2,
        filePaths: ['services/api/src/a.ts', 'services/api/src/b.ts'],
        confidence: 90,
        evidence: ['express router'],
      },
    ],
    modules: [
      {
        id: moduleId,
        layerId,
        serviceId,
        name: 'UserModule',
        kind: 'class',
        filePath: 'services/api/src/user.ts',
        methodCount: 1,
        propertyCount: 0,
        importCount: 2,
        exportCount: 1,
        superClass: null,
        lineCount: 40,
      },
    ],
    methods: [
      {
        id: methodId,
        moduleId,
        name: 'getUser',
        signature: 'getUser(id: string): User',
        paramCount: 1,
        returnType: 'User',
        isAsync: false,
        isExported: true,
        lineCount: 5,
        statementCount: 3,
        maxNestingDepth: 1,
      },
    ],
    moduleDeps: [],
    methodDeps: [],
    databases: [
      {
        id: dbId,
        name: 'primary',
        type: 'postgres',
        driver: 'pg',
        connectionConfig: null,
        tables: [{ name: 'users', columns: [] }],
        dbRelations: [],
        connectedServices: ['api'],
      },
    ],
    databaseConnections: [
      {
        id: randomUUID(),
        serviceId,
        databaseId: dbId,
        driver: 'pg',
      },
    ],
    flows: [
      {
        id: randomUUID(),
        name: 'get-user',
        description: null,
        entryService: 'api',
        entryMethod: 'getUser',
        category: 'read',
        trigger: 'http',
        stepCount: 1,
        steps: [
          {
            stepOrder: 1,
            sourceService: 'api',
            sourceModule: 'UserModule',
            sourceMethod: 'getUser',
            targetService: 'api',
            targetModule: 'UserModule',
            targetMethod: 'getUser',
            stepType: 'call',
            dataDescription: null,
            isAsync: false,
            isConditional: false,
          },
        ],
      },
    ],
  };
}

function makeViolation(graph: Graph, severity: ViolationRecord['severity']): ViolationRecord {
  return {
    id: randomUUID(),
    type: 'code',
    title: 'Example violation',
    content: 'Example content',
    severity,
    status: 'new',
    targetServiceId: graph.services[0]?.id ?? null,
    targetDatabaseId: null,
    targetModuleId: graph.modules[0]?.id ?? null,
    targetMethodId: graph.methods[0]?.id ?? null,
    targetTable: null,
    relatedServiceId: null,
    relatedModuleId: null,
    fixPrompt: null,
    ruleKey: 'code-quality/deterministic/example',
    firstSeenAnalysisId: null,
    firstSeenAt: '2026-04-21T10:00:00.000Z',
    previousViolationId: null,
    resolvedAt: null,
    filePath: 'services/api/src/user.ts',
    lineStart: 10,
    lineEnd: 10,
    columnStart: 0,
    columnEnd: 10,
    snippet: 'const x = 1;',
    createdAt: '2026-04-21T10:00:00.000Z',
  };
}

function denormalize(v: ViolationRecord, graph: Graph): ViolationWithNames {
  const service = graph.services.find((s) => s.id === v.targetServiceId);
  const mod = graph.modules.find((m) => m.id === v.targetModuleId);
  const method = graph.methods.find((m) => m.id === v.targetMethodId);
  const db = graph.databases.find((d) => d.id === v.targetDatabaseId);
  return {
    ...v,
    targetServiceName: service?.name ?? null,
    targetModuleName: mod?.name ?? null,
    targetMethodName: method?.name ?? null,
    targetDatabaseName: db?.name ?? null,
  };
}

interface SeedResult {
  analysisId: string;
  filename: string;
  graph: Graph;
  violations: ViolationWithNames[];
}

function seedStore(repoPath: string): SeedResult {
  const graph = makeGraph();
  const v1 = makeViolation(graph, 'critical');
  const v2 = makeViolation(graph, 'high');
  const added = [v1, v2];
  const violations = added.map((v) => denormalize(v, graph));

  const analysisId = randomUUID();
  const createdAt = '2026-04-21T10:00:00.000Z';
  const filename = `2026-04-21T10-00-00Z_${analysisId.replace(/-/g, '').slice(0, 8)}.json`;

  const snapshot: AnalysisSnapshot = {
    id: analysisId,
    createdAt,
    branch: 'main',
    commitHash: 'abc1234',
    architecture: 'monolith',
    status: 'completed',
    metadata: { isDiffAnalysis: false },
    graph,
    violations: {
      added,
      resolved: [],
      previousAnalysisId: null,
    },
    usage: [],
  };

  const latest: LatestSnapshot = {
    head: filename,
    analysis: {
      id: analysisId,
      createdAt,
      branch: 'main',
      commitHash: 'abc1234',
      architecture: 'monolith',
      metadata: { isDiffAnalysis: false },
      status: 'completed',
    },
    graph,
    violations,
  };

  const historyEntry: HistoryEntry = {
    id: analysisId,
    filename,
    createdAt,
    branch: 'main',
    commitHash: 'abc1234',
    metadata: { isDiffAnalysis: false },
    counts: {
      services: graph.services.length,
      modules: graph.modules.length,
      methods: graph.methods.length,
      violations: {
        new: added.length,
        unchanged: 0,
        resolved: 0,
        bySeverity: { critical: 1, high: 1, medium: 0, low: 0, info: 0 },
      },
    },
    usage: {
      totalTokens: 0,
      totalCostUsd: '0',
      durationMs: 1000,
      provider: '',
    },
  };

  writeAnalysis(repoPath, snapshot);
  writeLatest(repoPath, latest);
  appendHistory(repoPath, historyEntry);

  const diff: DiffSnapshot = {
    id: randomUUID(),
    baseAnalysisId: analysisId,
    createdAt: '2026-04-21T11:00:00.000Z',
    branch: 'main',
    commitHash: 'abc5678',
    graph,
    changedFiles: [{ path: 'services/api/src/user.ts', status: 'modified' }],
    newViolations: [],
    resolvedViolations: [],
    affectedNodeIds: { services: [], layers: [], modules: [], methods: [] },
    summary: { newCount: 0, unchangedCount: 2, resolvedCount: 0 },
    usage: [],
  };
  writeDiff(repoPath, diff);

  clearLatestCache();
  return { analysisId, filename, graph, violations };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('dashboard routes (seeded store)', () => {
  let fixture: TestFixture;
  let seed: SeedResult;
  let app: Express;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    seed = seedStore(fixture.repoPath);
    setLastAnalyzed(fixture.project.slug, seed.violations[0].createdAt);
    app = createApp({ serveStatic: false });
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  // -------------------------------------------------------------------------
  // repos
  // -------------------------------------------------------------------------

  describe('repos', () => {
    it('GET /api/repos lists the registered project with lastAnalyzed', async () => {
      const res = await request(app).get('/api/repos').expect(200);
      const match = (res.body as Array<{ id: string; lastAnalyzed: string | null }>)
        .find((r) => r.id === fixture.project.slug);
      expect(match).toBeDefined();
      expect(match!.lastAnalyzed).toBeTruthy();
    });

    it('GET /api/repos/:unknown returns 404 via projectResolver', async () => {
      await request(app).get('/api/repos/no-such-slug/config').expect(404);
    });

    it('POST /api/repos rejects a non-existent path with 400', async () => {
      await request(app)
        .post('/api/repos')
        .send({ path: '/definitely/not/a/real/path/xyz' })
        .expect(400);
    });

    it('POST /api/repos rejects a missing body with 400', async () => {
      await request(app).post('/api/repos').send({}).expect(400);
    });

    it('DELETE /api/repos/:id 204 + removes .truecourse', async () => {
      const tcDir = getRepoTruecourseDir(fixture.repoPath);
      expect(fs.existsSync(tcDir)).toBe(true);

      await request(app).delete(`/api/repos/${fixture.project.slug}`).expect(204);

      expect(getProjectBySlug(fixture.project.slug)).toBeNull();
      expect(fs.existsSync(tcDir)).toBe(false);
    });

    it('GET /api/repos/:id/config returns the project config', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/config`)
        .expect(200);
      expect(res.body).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // analyses
  // -------------------------------------------------------------------------

  describe('analyses', () => {
    it('GET /api/repos/:id/analyses returns history entries', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/analyses`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(seed.analysisId);
      expect(res.body[0].status).toBe('completed');
      expect(res.body[0].serviceCount).toBe(seed.graph.services.length);
    });

    it('GET /api/repos/:id/analyses/diff returns the seeded diff', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/analyses/diff`)
        .expect(200);
      expect(res.body).not.toBeNull();
      expect(res.body.summary.unchangedCount).toBe(2);
      expect(res.body.changedFiles).toHaveLength(1);
    });

    it('DELETE /api/repos/:id/analyses/:unknown returns 404', async () => {
      await request(app)
        .delete(`/api/repos/${fixture.project.slug}/analyses/00000000-0000-0000-0000-000000000000`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // graph
  // -------------------------------------------------------------------------

  describe('graph', () => {
    it('GET /api/repos/:id/graph returns nodes + edges from LATEST', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/graph`)
        .expect(200);
      expect(res.body.nodes).toBeDefined();
      expect(res.body.edges).toBeDefined();
      expect(res.body.nodes.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // violations
  // -------------------------------------------------------------------------

  describe('violations', () => {
    it('GET /api/repos/:id/violations returns the seeded set', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/violations`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(2);
    });

    it('GET /api/repos/:id/violations?severity=critical filters', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/violations?severity=critical`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBe(1);
      expect(res.body[0].severity).toBe('critical');
    });

    it('GET /api/repos/:id/violations/summary returns totals by severity', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/violations/summary`)
        .expect(200);
      expect(res.body.total).toBe(2);
      expect(res.body.bySeverity.critical).toBe(1);
      expect(res.body.bySeverity.high).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // flows
  // -------------------------------------------------------------------------

  describe('flows', () => {
    it('GET /api/repos/:id/flows returns the seeded flows', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/flows`)
        .expect(200);
      expect(Array.isArray(res.body.flows)).toBe(true);
      expect(res.body.flows).toHaveLength(1);
      expect(res.body.severities).toBeDefined();
    });

    it('GET /api/repos/:id/flows/:unknown returns 404', async () => {
      await request(app)
        .get(`/api/repos/${fixture.project.slug}/flows/00000000-0000-0000-0000-000000000000`)
        .expect(404);
    });
  });

  // -------------------------------------------------------------------------
  // files
  // -------------------------------------------------------------------------

  describe('files', () => {
    it('GET /api/repos/:id/file-content returns 400 on missing path', async () => {
      await request(app)
        .get(`/api/repos/${fixture.project.slug}/file-content`)
        .expect(400);
    });

    it('GET /api/repos/:id/file-content rejects path traversal with 403', async () => {
      await request(app)
        .get(`/api/repos/${fixture.project.slug}/file-content?path=../../etc/passwd`)
        .expect(403);
    });
  });

  // -------------------------------------------------------------------------
  // databases
  // -------------------------------------------------------------------------

  describe('databases', () => {
    it('GET /api/repos/:id/databases returns seeded databases', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/databases`)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].name).toBe('primary');
      expect(res.body[0].tableCount).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // analytics
  // -------------------------------------------------------------------------

  describe('analytics', () => {
    it('GET /api/repos/:id/analytics/trend returns { points: [...] }', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/analytics/trend`)
        .expect(200);
      expect(Array.isArray(res.body.points)).toBe(true);
      expect(res.body.points).toHaveLength(1);
      expect(res.body.points[0].analysisId).toBe(seed.analysisId);
    });

    it('GET /api/repos/:id/analytics/breakdown returns a response body', async () => {
      const res = await request(app)
        .get(`/api/repos/${fixture.project.slug}/analytics/breakdown`)
        .expect(200);
      expect(res.body).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // rules (not project-scoped)
  // -------------------------------------------------------------------------

  describe('rules', () => {
    it('GET /api/rules returns the catalogue', async () => {
      const res = await request(app).get('/api/rules').expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// LATEST-not-present scenarios
// ---------------------------------------------------------------------------

describe('dashboard routes (no analysis yet)', () => {
  let fixture: TestFixture;
  let app: Express;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
    clearLatestCache();
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET /graph returns empty nodes/edges when LATEST is missing', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/graph`)
      .expect(200);
    expect(res.body.nodes).toEqual([]);
    expect(res.body.edges).toEqual([]);
  });

  it('GET /violations returns an empty array when LATEST is missing', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/violations`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });

  it('GET /analyses/diff returns null when no diff exists', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/analyses/diff`)
      .expect(200);
    expect(res.body).toBeNull();
  });

  it('GET /databases returns an empty array', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/databases`)
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(0);
  });
});
