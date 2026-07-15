import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { AuthUser } from '@truecourse/shared';
// From the package (not src) so the JobStore's ActiveJobExistsError is the SAME
// class the router's `instanceof` check (also the package import) compares against.
import { JobStore } from '@truecourse/ee-data-store';

// The LLM-provider gate differs by endpoint: the sweep (`/estimate`) makes no LLM
// call and must run with no provider; the process (`/sync`) calls the LLM and
// keeps the gate. Drive `isLlmConfigured` so both directions are deterministic.
const llmConfigured = vi.fn(() => false);
vi.mock('../../ee/packages/server/src/llm/index', async (importActual) => {
  const actual = await importActual<typeof import('../../ee/packages/server/src/llm/index')>();
  return { ...actual, isLlmConfigured: () => llmConfigured() };
});

import { createKnowledgeRouter } from '../../ee/packages/server/src/knowledge/index';
import { NO_LLM_PROVIDER_MESSAGE } from '../../ee/packages/server/src/llm/index';
import { IntegrationStore } from '../../ee/packages/server/src/integrations/store';
import type { JobsApi } from '../../ee/packages/server/src/jobs/index';

const SECRET = 'master-secret-at-least-32-characters!!';
const ORG = 'org_A';
const CONFIG = { baseUrl: 'https://acme.atlassian.net', spaceKey: 'ENG', accountEmail: 'u@acme.test' };

/** A JobsApi whose enqueues are no-ops (the worker isn't running) over a real store. */
function makeJobs(db: EeDb): JobsApi {
  return {
    jobStore: new JobStore(db),
    enqueueSync: async () => {},
    enqueueEstimate: async () => {},
  } as unknown as JobsApi;
}

describe('Knowledge route — LLM-provider gate differs by endpoint', () => {
  let client: PGlite;
  let app: Express;
  let db: EeDb;

  beforeEach(async () => {
    client = new PGlite();
    db = drizzle(client, { schema }) as unknown as EeDb;
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    llmConfigured.mockReturnValue(false);
    // A configured connection so the endpoints get past the connection check.
    await new IntegrationStore(db, SECRET).save(ORG, 'confluence', { config: CONFIG, token: 'tok-abc' });

    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as Request & { eeUser?: AuthUser }).eeUser = {
        id: 'u1',
        email: 'u@acme.test',
        organizationId: ORG,
      };
      next();
    });
    app.use('/api/ee/knowledge', createKnowledgeRouter(db, SECRET, makeJobs(db)));
  });
  afterEach(async () => {
    await client.close();
  });

  it('sweep (/estimate) runs with NO provider configured; process (/sync) still 409s', async () => {
    const est = await request(app).post('/api/ee/knowledge/estimate').send({ kind: 'confluence' });
    expect(est.status).toBe(202);
    expect(est.body.jobId).toBeTruthy();

    const sync = await request(app).post('/api/ee/knowledge/sync').send({ kind: 'confluence' });
    expect(sync.status).toBe(409);
    expect(sync.body.error).toBe(NO_LLM_PROVIDER_MESSAGE);
  });

  it('process (/sync) enqueues once a provider is configured', async () => {
    llmConfigured.mockReturnValue(true);
    const sync = await request(app).post('/api/ee/knowledge/sync').send({ kind: 'confluence' });
    expect(sync.status).toBe(202);
    expect(sync.body.jobId).toBeTruthy();
  });

  it('process is single-flight PER WORKSPACE — a second Process (any source) 409s', async () => {
    llmConfigured.mockReturnValue(true);
    // Jira connected too — every source's Process button dispatches the same union job.
    await new IntegrationStore(db, SECRET).save(ORG, 'jira', {
      config: { baseUrl: 'https://acme.atlassian.net', projectKey: 'ENG', accountEmail: 'u@acme.test' },
      token: 'tok-jira',
    });

    const first = await request(app).post('/api/ee/knowledge/sync').send({ kind: 'confluence' });
    expect(first.status).toBe(202);

    // The Confluence job is still active → a Jira Process for the SAME org is a no-op.
    const second = await request(app).post('/api/ee/knowledge/sync').send({ kind: 'jira' });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/already in progress for this workspace/i);
    expect(second.body.jobId).toBe(first.body.jobId);
  });

  it('accepts every registry connector (kind is not a hardcoded list) and rejects unknown kinds cleanly', async () => {
    // Jira connected too — the registry, not a schema enum, decides valid kinds.
    await new IntegrationStore(db, SECRET).save(ORG, 'jira', {
      config: { baseUrl: 'https://acme.atlassian.net', projectKey: 'ENG', accountEmail: 'u@acme.test' },
      token: 'tok-jira',
    });
    const est = await request(app).post('/api/ee/knowledge/estimate').send({ kind: 'jira' });
    expect(est.status).toBe(202);
    expect(est.body.jobId).toBeTruthy();

    const unknown = await request(app).post('/api/ee/knowledge/estimate').send({ kind: 'notion' });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('Unknown connector: notion');
  });
});
