import express, { type Express, type Request } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { AuthUser } from '@truecourse/shared';
import { createIntegrationsRouter } from '../../ee/packages/server/src/integrations/index';

const SECRET = 'master-secret-at-least-32-characters!!';

async function makeDb(client: PGlite): Promise<EeDb> {
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as unknown as EeDb;
}

let client: PGlite;
let app: Express;
let currentOrg: string | null;

beforeEach(async () => {
  client = new PGlite();
  currentOrg = 'org_A';
  app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as Request & { eeUser?: AuthUser }).eeUser = currentOrg
      ? { id: 'u1', email: 'u@acme.test', organizationId: currentOrg }
      : undefined;
    next();
  });
  app.use('/api/ee/integrations', createIntegrationsRouter(await makeDb(client), SECRET));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await client.close();
});

const values = {
  baseUrl: 'https://acme.atlassian.net',
  spaceKey: 'ENG',
  accountEmail: 'u@acme.test',
};

describe('Integrations route', () => {
  it('GET / lists connectors with field metadata + null connection when unconfigured', async () => {
    const res = await request(app).get('/api/ee/integrations');
    expect(res.status).toBe(200);
    const confluence = res.body.connectors.find((c: { kind: string }) => c.kind === 'confluence');
    expect(confluence).toMatchObject({ kind: 'confluence', name: 'Confluence', connection: null });
    expect(confluence.fields.some((f: { secret?: boolean }) => f.secret)).toBe(true);
  });

  it('first connect requires the secret field (400)', async () => {
    const res = await request(app).post('/api/ee/integrations').send({ kind: 'confluence', values });
    expect(res.status).toBe(400);
  });

  it('connects, masks the token, never echoes it; omitting the token keeps it', async () => {
    const created = await request(app)
      .post('/api/ee/integrations')
      .send({ kind: 'confluence', values: { ...values, apiToken: 'tok-WXYZ7777' } });
    expect(created.status).toBe(200);
    expect(created.body.connection).toMatchObject({ hasToken: true, tokenMask: '••••7777' });
    expect(created.body.connection.config).toMatchObject({ spaceKey: 'ENG' });
    expect(JSON.stringify(created.body)).not.toContain('tok-WXYZ7777');

    const got = await request(app).get('/api/ee/integrations');
    expect(got.body.connectors.find((c: { kind: string }) => c.kind === 'confluence').connection.hasToken).toBe(true);

    // Update non-secret fields without resending the token → token preserved.
    const updated = await request(app)
      .post('/api/ee/integrations')
      .send({ kind: 'confluence', values: { ...values, spaceKey: 'DOCS' } });
    expect(updated.body.connection).toMatchObject({ hasToken: true, config: expect.objectContaining({ spaceKey: 'DOCS' }) });
  });

  it('POST /test probes the connector live (ok / error), never leaking the token', async () => {
    await request(app)
      .post('/api/ee/integrations')
      .send({ kind: 'confluence', values: { ...values, apiToken: 'tok-test1' } });

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const ok = String(input).includes('spaceKey=ENG');
      return new Response(JSON.stringify(ok ? { results: [] } : { message: 'no' }), {
        status: ok ? 200 : 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }));
    const ok = await request(app).post('/api/ee/integrations/test').send({ kind: 'confluence', values });
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ ok: true });

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const bad = await request(app).post('/api/ee/integrations/test').send({ kind: 'confluence', values });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toContain('tok-test1');
  });

  it('DELETE /:kind disconnects', async () => {
    await request(app).post('/api/ee/integrations').send({ kind: 'confluence', values: { ...values, apiToken: 'tok-1' } });
    expect((await request(app).delete('/api/ee/integrations/confluence')).body).toEqual({ ok: true });
    const got = await request(app).get('/api/ee/integrations');
    expect(got.body.connectors.find((c: { kind: string }) => c.kind === 'confluence').connection).toBeNull();
  });

  it('rejects an unknown connector + 401s without a workspace org', async () => {
    expect((await request(app).post('/api/ee/integrations').send({ kind: 'nope', values })).status).toBe(400);
    currentOrg = null;
    expect((await request(app).get('/api/ee/integrations')).status).toBe(401);
    expect((await request(app).post('/api/ee/integrations').send({ kind: 'confluence', values })).status).toBe(401);
    expect((await request(app).delete('/api/ee/integrations/confluence')).status).toBe(401);
  });
});
