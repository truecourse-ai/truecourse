import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { AuthUser } from '@truecourse/shared';
import {
  setContractStore,
  resetContractStore,
  saveWorkspaceContracts,
} from '@truecourse/core/lib/contract-store';
import { PgContractStore } from '../../ee/packages/data-store/src/index';
import { FsBlobStore } from '../../ee/packages/storage/src/index';

// The consolidation pipeline is exercised by the driver test; here we mock the
// core driver + read helpers so the route's own concerns (auth scoping, input
// validation, provenance reconciliation, response shape) are tested in isolation.
vi.mock('@truecourse/core/commands/spec-in-process', () => ({
  scanWorkspaceInProcess: vi.fn(),
  getWorkspaceScanState: vi.fn(),
  getWorkspaceClaims: vi.fn(),
  getWorkspaceDecisions: vi.fn(),
  upsertWorkspaceDecision: vi.fn(),
  revokeWorkspaceDecision: vi.fn(),
  resolveAllWorkspaceDefaults: vi.fn(),
  addWorkspaceManualChain: vi.fn(),
  removeWorkspaceManualChain: vi.fn(),
  addWorkspaceManualInclude: vi.fn(),
  removeWorkspaceManualInclude: vi.fn(),
  // A decision refreshes the contract corpus (best-effort); mock it as a no-op.
  generateWorkspaceContractsInProcess: vi.fn().mockResolvedValue({ kind: 'skipped' }),
}));

import {
  scanWorkspaceInProcess,
  getWorkspaceScanState,
  getWorkspaceClaims,
  getWorkspaceDecisions,
  upsertWorkspaceDecision,
  revokeWorkspaceDecision,
  resolveAllWorkspaceDefaults,
} from '@truecourse/core/commands/spec-in-process';
import { createKnowledgeRouter } from '../../ee/packages/server/src/knowledge/index';
import { IntegrationStore } from '../../ee/packages/server/src/integrations/store';
// Package path (dist), NOT source — the /sync route imports ActiveJobExistsError
// from the same package, so the JobStore here must throw the matching class for
// the route's `instanceof` (single-flight 409) to fire.
import { JobStore } from '@truecourse/ee-data-store';
import type { JobsApi } from '../../ee/packages/server/src/jobs/index';
import { setDefaultTransport } from '@truecourse/shared/llm';

const SECRET = 'test-master-secret-32-characters!!';

const SCAN_STATE = { scannedAt: '2026-06-05T00:00:00Z', openConflicts: [], decidedConflicts: [] };

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

let client: PGlite;
let app: Express;
let currentOrg: string | null;
let blobDir: string;
let db: EeDb;
let jobStore: JobStore;
let enqueueSync: ReturnType<typeof vi.fn>;
let enqueueWorkspaceContracts: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.mocked(scanWorkspaceInProcess).mockResolvedValue({ scanState: SCAN_STATE } as never);
  vi.mocked(getWorkspaceScanState).mockResolvedValue(SCAN_STATE as never);
  vi.mocked(getWorkspaceClaims).mockResolvedValue({ version: 1, claims: [] } as never);
  vi.mocked(getWorkspaceDecisions).mockResolvedValue({
    version: 1,
    decisions: [],
    manualChains: [],
    manualIncludes: [],
  } as never);
  vi.mocked(upsertWorkspaceDecision).mockResolvedValue(SCAN_STATE as never);
  vi.mocked(revokeWorkspaceDecision).mockResolvedValue(SCAN_STATE as never);
  vi.mocked(resolveAllWorkspaceDefaults).mockResolvedValue(SCAN_STATE as never);

  client = new PGlite();
  currentOrg = 'org_A';
  blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-kroute-blob-'));
  db = await makeDb(client);
  // The contracts routes read through the global contract store; install the
  // Postgres/Blob impl so a seeded workspace corpus is visible to the route.
  setContractStore(new PgContractStore(db, new FsBlobStore(blobDir)));
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { eeUser?: AuthUser }).eeUser = currentOrg
      ? { id: 'u1', email: 'u@acme.test', organizationId: currentOrg }
      : undefined;
    next();
  });
  jobStore = new JobStore(db);
  enqueueSync = vi.fn().mockResolvedValue(undefined);
  enqueueWorkspaceContracts = vi.fn().mockResolvedValue(undefined);
  const jobs = { jobStore, enqueueSync, enqueueWorkspaceContracts } as unknown as JobsApi;
  app.use('/api/ee/knowledge', createKnowledgeRouter(db, SECRET, jobs));
});

afterEach(async () => {
  vi.clearAllMocks();
  resetContractStore();
  // Clear any provider transport a test installed, so the no-provider gate test
  // (which relies on an unset transport) stays valid regardless of test order.
  setDefaultTransport(undefined);
  await client.close();
  fs.rmSync(blobDir, { recursive: true, force: true });
});

describe('Knowledge route — auth scoping', () => {
  it('401s every route when the request has no workspace org', async () => {
    currentOrg = null;
    for (const p of ['/scan-state', '/claims', '/decisions', '/documents']) {
      expect((await request(app).get(`/api/ee/knowledge${p}`)).status).toBe(401);
    }
    expect((await request(app).post('/api/ee/knowledge/sync').send({ kind: 'confluence' })).status).toBe(401);
  });
});

describe('Knowledge route — reads', () => {
  it('GET /scan-state returns the workspace scan-state, or 404 when none', async () => {
    expect((await request(app).get('/api/ee/knowledge/scan-state')).body).toEqual(SCAN_STATE);
    vi.mocked(getWorkspaceScanState).mockResolvedValueOnce(null);
    expect((await request(app).get('/api/ee/knowledge/scan-state')).status).toBe(404);
  });

  it('GET /claims and /decisions return the workspace artifacts', async () => {
    expect((await request(app).get('/api/ee/knowledge/claims')).body).toEqual({ version: 1, claims: [] });
    expect((await request(app).get('/api/ee/knowledge/decisions')).body.version).toBe(1);
  });
});

describe('Knowledge route — decisions (full resolve)', () => {
  it('POST /decisions validates + resolves a conflict, returning the refreshed scan-state', async () => {
    const bad = await request(app).post('/api/ee/knowledge/decisions').send({ conflictId: 'c1' });
    expect(bad.status).toBe(400); // missing resolution + fingerprint

    const ok = await request(app)
      .post('/api/ee/knowledge/decisions')
      .send({ conflictId: 'c1', resolution: { kind: 'pick', candidateIndex: 1 }, candidateFingerprint: 'fp' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual(SCAN_STATE);
    expect(vi.mocked(upsertWorkspaceDecision)).toHaveBeenCalledWith('org_A', {
      conflictId: 'c1',
      resolution: { kind: 'pick', candidateIndex: 1 },
      candidateFingerprint: 'fp',
    });
    // The decision changed the canonical claims → the contract refresh is ENQUEUED
    // (background, off the request path) — no manual "Generate" button.
    expect(enqueueWorkspaceContracts).toHaveBeenCalledWith('org_A');
  });

  it('a contract-refresh enqueue failure does NOT fail the decision (best-effort)', async () => {
    enqueueWorkspaceContracts.mockRejectedValueOnce(new Error('queue down'));
    const res = await request(app)
      .post('/api/ee/knowledge/decisions')
      .send({ conflictId: 'c1', resolution: { kind: 'pick', candidateIndex: 0 }, candidateFingerprint: 'fp' });
    expect(res.status).toBe(200); // the resolution is already persisted; regen is derived
    expect(res.body).toEqual(SCAN_STATE);
  });

  it('DELETE /decisions/:id revokes; POST /decisions/batch accepts all defaults', async () => {
    expect((await request(app).delete('/api/ee/knowledge/decisions/c1')).status).toBe(200);
    expect(vi.mocked(revokeWorkspaceDecision)).toHaveBeenCalledWith('org_A', 'c1');

    const batch = await request(app).post('/api/ee/knowledge/decisions/batch').send({ mode: 'all-defaults' });
    expect(batch.status).toBe(200);
    expect(vi.mocked(resolveAllWorkspaceDefaults)).toHaveBeenCalledWith('org_A');

    const badBatch = await request(app).post('/api/ee/knowledge/decisions/batch').send({ mode: 'nope' });
    expect(badBatch.status).toBe(400);
  });

  it('decision routes 401 without a workspace org', async () => {
    currentOrg = null;
    expect((await request(app).post('/api/ee/knowledge/decisions').send({})).status).toBe(401);
    expect((await request(app).post('/api/ee/knowledge/decisions/batch').send({ mode: 'all-defaults' })).status).toBe(401);
  });
});

describe('Knowledge route — contracts', () => {
  const CORPUS = {
    '_shared/auth.tc': 'auth requirement',
    'orders/operations/post-api-orders.tc': 'operation POST "/api/orders" {}',
  };

  it('GET /contracts/tree returns the grouped workspace corpus (empty when none)', async () => {
    const empty = await request(app).get('/api/ee/knowledge/contracts/tree');
    expect(empty.body).toEqual({ hasContracts: false, modules: [] });

    await saveWorkspaceContracts({ workspaceOrgId: 'org_A' }, 'contracts', CORPUS);
    const res = await request(app).get('/api/ee/knowledge/contracts/tree');
    expect(res.body.hasContracts).toBe(true);
    // `_shared` sorts first; each module carries its files.
    expect(res.body.modules.map((m: { name: string }) => m.name)).toEqual(['_shared', 'orders']);
    expect(res.body.modules[1].files[0].path).toBe('orders/operations/post-api-orders.tc');
  });

  it('GET /contracts/file returns one .tc body; 404 on a missing/traversal path', async () => {
    await saveWorkspaceContracts({ workspaceOrgId: 'org_A' }, 'contracts', CORPUS);
    const ok = await request(app)
      .get('/api/ee/knowledge/contracts/file')
      .query({ path: 'orders/operations/post-api-orders.tc' });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({
      path: 'orders/operations/post-api-orders.tc',
      content: 'operation POST "/api/orders" {}',
    });

    expect((await request(app).get('/api/ee/knowledge/contracts/file').query({ path: '../escape.tc' })).status).toBe(404);
    expect((await request(app).get('/api/ee/knowledge/contracts/file')).status).toBe(400); // no path
  });

  it('contracts routes 401 without a workspace org', async () => {
    currentOrg = null;
    expect((await request(app).get('/api/ee/knowledge/contracts/tree')).status).toBe(401);
    expect((await request(app).get('/api/ee/knowledge/contracts/file').query({ path: 'x.tc' })).status).toBe(401);
  });
});

describe('Knowledge route — sync', () => {
  it('POST /sync 400s without a kind, 409s when the source is not connected', async () => {
    // No kind → validation 400.
    expect((await request(app).post('/api/ee/knowledge/sync').send({})).status).toBe(400);
    // Valid kind but no stored Confluence connection → 409.
    const res = await request(app).post('/api/ee/knowledge/sync').send({ kind: 'confluence' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Settings → Integrations/i);
  });

  it('POST /sync 409s with a no-provider message once connected but no LLM is configured', async () => {
    // A connected source clears the "not connected" 409, so the request reaches
    // the LLM-provider gate. No transport is installed in this test, so the gate
    // must reject loudly — otherwise the consolidator's fail-open relevance
    // filter would swallow the "no provider" error and report a hollow success.
    await new IntegrationStore(db, SECRET).save('org_A', 'confluence', {
      config: { baseUrl: 'https://acme.atlassian.net', spaceKey: 'ENG', accountEmail: 'u@acme.test' },
      token: 'tok',
    });
    const res = await request(app).post('/api/ee/knowledge/sync').send({ kind: 'confluence' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/No LLM provider is configured/i);
  });

  it('POST /sync enqueues a job and 202s once connected + a provider is set', async () => {
    await new IntegrationStore(db, SECRET).save('org_A', 'confluence', {
      config: { baseUrl: 'https://acme.atlassian.net', spaceKey: 'ENG', accountEmail: 'u@acme.test' },
      token: 'tok',
    });
    setDefaultTransport(async () => '{}'); // a real provider transport ⇒ isLlmConfigured() true

    const res = await request(app).post('/api/ee/knowledge/sync').send({ kind: 'confluence' });
    expect(res.status).toBe(202);
    expect(typeof res.body.jobId).toBe('string');
    // The work is enqueued, not run inline.
    expect(enqueueSync).toHaveBeenCalledTimes(1);
    expect(enqueueSync).toHaveBeenCalledWith(
      { jobId: res.body.jobId, org: 'org_A', kind: 'confluence' },
      'knowledge.sync:confluence',
    );
    // A job row now backs the active sync (this is what the UI seeds "Syncing" from).
    expect((await jobStore.getActiveByKey('org_A', 'knowledge.sync:confluence'))?.id).toBe(res.body.jobId);
  });

  it('POST /sync rejects a concurrent sync for the same source with 409', async () => {
    await new IntegrationStore(db, SECRET).save('org_A', 'confluence', {
      config: { baseUrl: 'https://acme.atlassian.net', spaceKey: 'ENG', accountEmail: 'u@acme.test' },
      token: 'tok',
    });
    setDefaultTransport(async () => '{}');

    const first = await request(app).post('/api/ee/knowledge/sync').send({ kind: 'confluence' });
    expect(first.status).toBe(202);

    const second = await request(app).post('/api/ee/knowledge/sync').send({ kind: 'confluence' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already in progress/i);
    expect(second.body.jobId).toBe(first.body.jobId); // points at the active job
    // The second request did NOT enqueue a duplicate.
    expect(enqueueSync).toHaveBeenCalledTimes(1);
  });
});
