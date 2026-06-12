import express, { type Express, type Request } from 'express';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { AuthUser, LlmTraceInput } from '@truecourse/shared';
import { FsBlobStore } from '../../ee/packages/storage/src/index';
import { PgTraceStore, JobStore } from '../../ee/packages/data-store/src/index';
import { createAdminRouter } from '../../ee/packages/server/src/admin/index';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

function trace(over: Partial<LlmTraceInput> = {}): LlmTraceInput {
  return {
    workspaceOrgId: 'org_A',
    traceId: 't1',
    parentId: null,
    stage: 'contract.extract',
    callId: 'contract.extract:s1',
    sliceId: 's1',
    module: null,
    topic: null,
    model: 'm',
    status: 'ok',
    errorMessage: null,
    finishReason: 'stop',
    usedFallback: false,
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    reasoningTokens: null,
    latencyMs: 42,
    system: 'SYS',
    user: 'USER',
    output: 'OUT',
    reasoning: null,
    metadata: null,
    ...over,
  };
}

let client: PGlite;
let blobDir: string;
let app: Express;
/** Toggled per test: the operator sees all, the member is 403'd. */
let currentUser: Partial<AuthUser> | null;

beforeEach(async () => {
  client = new PGlite();
  blobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-blob-'));
  const db = await makeDb(client);
  const blob = new FsBlobStore(blobDir);
  const traceStore = new PgTraceStore(db, blob);
  const jobStore = new JobStore(db);

  // Seed traces + jobs across two orgs.
  await traceStore.record(trace({ workspaceOrgId: 'org_A', callId: 'a:1', output: 'A1' }));
  await traceStore.record(trace({ workspaceOrgId: 'org_A', callId: 'a:2', output: 'A2' })); // same prompt as a:1
  // A distinct prompt in another org, so the by-prompt grouping is meaningful.
  await traceStore.record(
    trace({ workspaceOrgId: 'org_B', callId: 'b:1', output: 'B1', system: 'OTHER', user: 'OTHER' }),
  );
  await jobStore.create({ org: 'org_A', type: 'knowledge.sync', key: 'k:a' });
  await jobStore.create({ org: 'org_B', type: 'repo.baseline', key: 'k:b' });

  currentUser = { id: 'op', email: 'op@truecourse.ai', isOperator: true };
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { eeUser?: AuthUser }).eeUser = currentUser
      ? ({ organizationId: 'org_A', ...currentUser } as AuthUser)
      : undefined;
    next();
  });
  app.use('/api/ee/admin', createAdminRouter({ db, traceStore }));
});
afterEach(async () => {
  await client.close();
  fs.rmSync(blobDir, { recursive: true, force: true });
});

describe('Admin console routes — operator gate + cross-org scope', () => {
  it('403s a non-operator on every route', async () => {
    currentUser = { id: 'm', email: 'm@acme.test', isOperator: false };
    for (const p of ['/traces', '/traces/orgs', '/traces/stats', '/jobs']) {
      const res = await request(app).get(`/api/ee/admin${p}`);
      expect(res.status).toBe(403);
    }
  });

  it('403s when there is no authenticated user', async () => {
    currentUser = null;
    expect((await request(app).get('/api/ee/admin/traces')).status).toBe(403);
  });

  it('operator lists traces across ALL orgs, and can scope to one', async () => {
    const all = await request(app).get('/api/ee/admin/traces');
    expect(all.status).toBe(200);
    expect(all.body.traces).toHaveLength(3);

    const scoped = await request(app).get('/api/ee/admin/traces').query({ org: 'org_B' });
    expect(scoped.body.traces).toHaveLength(1);
    expect(scoped.body.traces[0].workspaceOrgId).toBe('org_B');
  });

  it('lists distinct orgs and cross-org stats', async () => {
    const orgs = await request(app).get('/api/ee/admin/traces/orgs');
    expect(orgs.body.orgs).toEqual(['org_A', 'org_B']);

    const stats = await request(app).get('/api/ee/admin/traces/stats');
    expect(stats.body.totalCalls).toBe(3);
  });

  it('fetches a trace detail with hydrated payloads, and the same-prompt divergence set', async () => {
    const list = await request(app).get('/api/ee/admin/traces').query({ org: 'org_A' });
    const first = list.body.traces[0];

    const detail = await request(app).get(`/api/ee/admin/traces/${first.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.trace.system).toBe('SYS');
    expect(typeof detail.body.trace.output).toBe('string');

    // a:1 and a:2 share an identical prompt → both come back for that hash.
    const byPrompt = await request(app).get(`/api/ee/admin/traces/by-prompt/${first.promptHash}`);
    expect(byPrompt.body.traces.length).toBe(2);

    const missing = await request(app).get('/api/ee/admin/traces/does-not-exist');
    expect(missing.status).toBe(404);
  });

  it('lists jobs across all orgs (with org in each row), filterable by org', async () => {
    const all = await request(app).get('/api/ee/admin/jobs');
    expect(all.status).toBe(200);
    expect(all.body.jobs).toHaveLength(2);
    expect(all.body.jobs.every((j: { workspaceOrgId: string }) => j.workspaceOrgId)).toBe(true);

    const scoped = await request(app).get('/api/ee/admin/jobs').query({ org: 'org_A' });
    expect(scoped.body.jobs).toHaveLength(1);
    expect(scoped.body.jobs[0].workspaceOrgId).toBe('org_A');
  });
});
