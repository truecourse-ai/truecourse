/**
 * The Knowledge page's Scenarios-tab endpoints under /api/ee/knowledge/guard:
 * explicit generation (409 while a spec conflict is open — the SAME shared
 * `openConflicts` derivation the repo gate uses — else the org-scoped single-flight
 * job), the pre-flight estimate (404 before any corpus), and the scenario-corpus
 * reads (coverage + one scenario's source). The generate/coverage/scenario routes
 * never touch a connector, so no connector stub is needed.
 */
import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { AuthUser } from '@truecourse/shared';
import { setSpecStore, resetSpecStore, saveWorkspaceSpec } from '@truecourse/core/lib/spec-store';
import { setGuardStore, resetGuardStore } from '@truecourse/core/lib/guard-store';
// JobStore from the package (not src) so the router's `instanceof ActiveJobExistsError`
// check (also a package import) compares against the SAME class.
import { JobStore } from '@truecourse/ee-data-store';

// Control the provider gate on /guard/generate.
const llmConfigured = vi.fn(() => true);
vi.mock('../../ee/packages/server/src/llm/index', async (importActual) => {
  const actual = await importActual<typeof import('../../ee/packages/server/src/llm/index')>();
  return { ...actual, isLlmConfigured: () => llmConfigured() };
});

import { PgSpecStore, PgGuardStore } from '../../ee/packages/data-store/src/index';
import { createKnowledgeRouter } from '../../ee/packages/server/src/knowledge/index';
import { KNOWLEDGE_GUARD_TASK, workspaceGuardJobKey } from '../../ee/packages/server/src/jobs/constants';
import type { JobsApi } from '../../ee/packages/server/src/jobs/index';

const SECRET = 'master-secret-at-least-32-characters!!';
const ORG = 'org_guard_route';

/** A one-doc, no-conflict corpus. */
const CLEAN_CORPUS = {
  version: 3 as const,
  generatedAt: '2026-07-14T00:00:00Z',
  docs: [{ ref: 'knowledge/confluence/1.md', kind: 'spec', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/checkout'] }],
  areas: [{ id: 'core/checkout', product: 'core', concern: 'checkout', docRefs: ['knowledge/confluence/1.md'], overlaps: [] }],
  relations: [],
  skippedDocs: [],
};

/** A corpus with one unresolved within-area overlap. */
const CONFLICT_CORPUS = {
  version: 3 as const,
  generatedAt: '2026-07-14T00:00:00Z',
  docs: [
    { ref: 'knowledge/confluence/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/users'] },
    { ref: 'knowledge/jira/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/users'] },
  ],
  areas: [
    {
      id: 'booking/users',
      product: 'booking',
      concern: 'users',
      docRefs: ['knowledge/confluence/v1.md', 'knowledge/jira/v2.md'],
      overlaps: [{ docs: ['knowledge/confluence/v1.md', 'knowledge/jira/v2.md'], note: 'auth0_id vs auth0_sub', sections: [] }],
    },
  ],
  relations: [],
  skippedDocs: [],
};

describe('Knowledge guard routes', () => {
  let client: PGlite;
  let db: EeDb;
  let app: Express;
  let enqueueGuard: ReturnType<typeof vi.fn>;

  function makeJobs(): JobsApi {
    return {
      jobStore: new JobStore(db),
      enqueueSync: vi.fn(async () => {}),
      enqueueEstimate: vi.fn(async () => {}),
      enqueueGuard,
    } as unknown as JobsApi;
  }

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema }) as unknown as EeDb;
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    setSpecStore(new PgSpecStore(db));
    setGuardStore(new PgGuardStore(db));
    llmConfigured.mockReturnValue(true);
    enqueueGuard = vi.fn(async () => {});
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as Request & { eeUser?: AuthUser }).eeUser = { id: 'u1', email: 'u@acme.test', organizationId: ORG };
      next();
    });
    app.use('/api/ee/knowledge', createKnowledgeRouter(db, SECRET, makeJobs()));
  });

  afterEach(async () => {
    resetSpecStore();
    resetGuardStore();
    await client.close();
  });

  // --- Generate --------------------------------------------------------------

  it('POST /guard/generate → 409 before any corpus is processed', async () => {
    const res = await request(app).post('/api/ee/knowledge/guard/generate');
    expect(res.status).toBe(409);
    expect(enqueueGuard).not.toHaveBeenCalled();
  });

  it('POST /guard/generate → 409 while a spec conflict is open (nothing enqueued)', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', CONFLICT_CORPUS);
    const res = await request(app).post('/api/ee/knowledge/guard/generate');
    expect(res.status).toBe(409);
    expect(res.body.openConflicts).toBe(1);
    expect(res.body.error).toContain('conflict');
    expect(enqueueGuard).not.toHaveBeenCalled();
  });

  it('POST /guard/generate → 409 when no LLM provider is configured', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', CLEAN_CORPUS);
    llmConfigured.mockReturnValue(false);
    const res = await request(app).post('/api/ee/knowledge/guard/generate');
    expect(res.status).toBe(409);
    expect(enqueueGuard).not.toHaveBeenCalled();
  });

  it('POST /guard/generate → 202 + enqueues the org-scoped job when the corpus is clean', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', CLEAN_CORPUS);
    const res = await request(app).post('/api/ee/knowledge/guard/generate');
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
    expect(enqueueGuard).toHaveBeenCalledTimes(1);
    expect(enqueueGuard).toHaveBeenCalledWith(
      { jobId: res.body.jobId, org: ORG },
      workspaceGuardJobKey(ORG),
    );
  });

  it('POST /guard/generate → 409 when a generate is already in flight (single-flight)', async () => {
    await saveWorkspaceSpec({ workspaceOrgId: ORG }, 'corpus', CLEAN_CORPUS);
    // Pre-create the active job so the router's create hits ActiveJobExistsError.
    await new JobStore(db).create({ org: ORG, type: KNOWLEDGE_GUARD_TASK, key: workspaceGuardJobKey(ORG) });
    const res = await request(app).post('/api/ee/knowledge/guard/generate');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('already in progress');
    expect(enqueueGuard).not.toHaveBeenCalled();
  });

  // --- Estimate --------------------------------------------------------------

  it('POST /guard/estimate → 404 before any corpus is processed', async () => {
    const res = await request(app).post('/api/ee/knowledge/guard/estimate');
    expect(res.status).toBe(404);
  });

  // --- Reads -----------------------------------------------------------------

  it('GET /guard/coverage → 200 with an empty payload before the first generate', async () => {
    const res = await request(app).get('/api/ee/knowledge/guard/coverage');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      report: null,
      recipe: null,
      scenarios: [],
      hasGenerated: false,
      hasScenarios: false,
    });
  });

  it('GET /guard/scenario → 400 without an id, 404 for an unknown id', async () => {
    expect((await request(app).get('/api/ee/knowledge/guard/scenario')).status).toBe(400);
    expect((await request(app).get('/api/ee/knowledge/guard/scenario?id=nope')).status).toBe(404);
  });
});
