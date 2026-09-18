/**
 * Settings › Connections, over the real routes and the real store (PGlite + the
 * drizzle migrations).
 *
 * What is pinned: a connection is the ACCOUNT — one Atlassian row serving both
 * the Jira and the Confluence source kinds — and the page only ever sees it
 * masked, a re-save that leaves the token blank keeps the stored one, Test runs
 * the read a sync makes ONCE PER PRODUCT with the submitted token or the stored
 * one and answers a verdict for each, removing a connection PAUSES every source
 * of every kind it served without touching their documents, and both mutations
 * report themselves as one product action each.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_DIR, schema, type Db } from '@truecourse/db';
import type { ContextSourceKind } from '@truecourse/shared';
import { resetContextStore, setContextStore } from '@truecourse/core/lib/context-store';
import {
  ConnectionStore,
  createConnectionsRouter,
  type AtlassianConnection,
} from '../../ee/packages/server/src/connections/index';
import { memoryContextStore, type MemoryContextStore } from '../helpers/memory-context-store';

const ORG = 'org_test';
const SECRET = 'a-master-secret-of-at-least-32-characters';

let client: PGlite;
let db: Db;
let store: ConnectionStore;
let app: Express;
let context: MemoryContextStore;
/** Every probe the Test route ran, with the product and the credentials it settled on. */
let probes: { kind: ContextSourceKind; connection: AtlassianConnection }[];
/** Which products refuse the next probe, and in what words. */
let probeRefusals: Partial<Record<ContextSourceKind, string>>;
/** The product actions the routes reported. */
let captured: { event: string; properties?: Record<string, unknown> }[];
let changes: { org: string; change: string }[];

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  store = new ConnectionStore(db, SECRET);
  context = memoryContextStore();
  setContextStore(context);
  probes = [];
  probeRefusals = {};
  captured = [];
  changes = [];

  app = express();
  app.use(express.json());
  // The session the gate would have resolved.
  app.use((req, _res, next) => {
    (req as { user?: unknown }).user = { id: 'user_test', organizationId: ORG };
    next();
  });
  app.use(
    '/api/connections',
    createConnectionsRouter({
      store,
      probe: async (kind, connection) => {
        probes.push({ kind, connection });
        const refusal = probeRefusals[kind];
        if (refusal) throw new Error(refusal);
      },
      context: {
        capture: (event, _req, properties) => {
          captured.push({ event, ...(properties ? { properties } : {}) });
        },
        contextChanged: async (org, change) => {
          changes.push({ org, change: change.change });
        },
      },
    }),
  );
});

afterEach(async () => {
  resetContextStore();
  await client.close();
  vi.restoreAllMocks();
});

const ACCOUNT = {
  baseUrl: 'https://acme.atlassian.net',
  accountEmail: 'u@acme.test',
  apiToken: 'super-secret-token',
};

describe('the connections listing', () => {
  it('lists the one account with the kinds it serves, and never the token', async () => {
    const got = await request(app).get('/api/connections').expect(200);
    expect(got.body.connections).toEqual([
      {
        provider: 'atlassian',
        kinds: ['jira', 'confluence'],
        connected: false,
        baseUrl: '',
        accountEmail: '',
        tokenMask: null,
        updatedAt: null,
      },
    ]);
  });

  it('shows a connected account masked: the login, and the token’s last four', async () => {
    await request(app).put('/api/connections/atlassian').send(ACCOUNT).expect(200);
    const got = await request(app).get('/api/connections').expect(200);
    expect(got.body.connections).toHaveLength(1);
    expect(got.body.connections[0]).toMatchObject({
      provider: 'atlassian',
      kinds: ['jira', 'confluence'],
      connected: true,
      baseUrl: 'https://acme.atlassian.net',
      accountEmail: 'u@acme.test',
      tokenMask: '••••oken',
    });
    expect(JSON.stringify(got.body)).not.toContain('super-secret-token');
  });
});

describe('saving a connection', () => {
  it('stores the account and the token, and reports the action', async () => {
    await request(app).put('/api/connections/atlassian').send(ACCOUNT).expect(200);
    expect(await store.getConnection(ORG, 'atlassian')).toEqual({
      baseUrl: 'https://acme.atlassian.net',
      accountEmail: 'u@acme.test',
      apiToken: 'super-secret-token',
    });
    expect(captured).toEqual([
      { event: 'connection_saved', properties: { provider: 'atlassian' } },
    ]);
  });

  it('keeps the stored token when a re-save leaves the field blank', async () => {
    await request(app).put('/api/connections/atlassian').send(ACCOUNT).expect(200);
    await request(app)
      .put('/api/connections/atlassian')
      .send({ baseUrl: 'https://acme.atlassian.net/', accountEmail: 'other@acme.test' })
      .expect(200);
    expect(await store.getConnection(ORG, 'atlassian')).toEqual({
      // The trailing slash is normalized away, so a path is never doubled.
      baseUrl: 'https://acme.atlassian.net',
      accountEmail: 'other@acme.test',
      apiToken: 'super-secret-token',
    });
  });

  it('refuses a first connection with no token, and an unusable site URL', async () => {
    const tokenless = await request(app)
      .put('/api/connections/atlassian')
      .send({ baseUrl: ACCOUNT.baseUrl, accountEmail: ACCOUNT.accountEmail })
      .expect(400);
    expect(tokenless.body.error).toMatch(/API token is required/);

    const badUrl = await request(app)
      .put('/api/connections/atlassian')
      .send({ ...ACCOUNT, baseUrl: 'acme.atlassian.net' })
      .expect(400);
    expect(badUrl.body.error).toMatch(/full URL/);
    expect(captured).toEqual([]);
  });

  it('refuses a name that is not an account: a source kind, or a tool with no connection', async () => {
    // Jira is a KIND a source is made of, never an account of its own.
    await request(app).put('/api/connections/jira').send(ACCOUNT).expect(404);
    await request(app).put('/api/connections/notion').send(ACCOUNT).expect(404);
  });

  it('keeps one workspace’s connection out of another’s', async () => {
    await request(app).put('/api/connections/atlassian').send(ACCOUNT).expect(200);
    expect(await store.getConnection('org_other', 'atlassian')).toBeNull();
  });
});

describe('testing a connection', () => {
  it('probes every product with the submitted token, and answers for each', async () => {
    const got = await request(app)
      .post('/api/connections/atlassian/test')
      .send(ACCOUNT)
      .expect(200);
    expect(got.body).toEqual({
      ok: true,
      products: { jira: { ok: true }, confluence: { ok: true } },
    });
    expect(probes).toEqual([
      { kind: 'jira', connection: ACCOUNT },
      { kind: 'confluence', connection: ACCOUNT },
    ]);
  });

  it('runs them with the STORED token when the field was left masked', async () => {
    await request(app).put('/api/connections/atlassian').send(ACCOUNT).expect(200);
    await request(app)
      .post('/api/connections/atlassian/test')
      .send({ baseUrl: ACCOUNT.baseUrl, accountEmail: ACCOUNT.accountEmail })
      .expect(200);
    expect(probes.map((probe) => probe.connection.apiToken)).toEqual([
      'super-secret-token',
      'super-secret-token',
    ]);
  });

  it('is a usable account when one product answers and the other has no licence', async () => {
    probeRefusals = { confluence: 'This site has no Confluence.' };
    const got = await request(app)
      .post('/api/connections/atlassian/test')
      .send(ACCOUNT)
      .expect(200);
    expect(got.body).toEqual({
      ok: true,
      products: {
        jira: { ok: true },
        confluence: { ok: false, error: 'This site has no Confluence.' },
      },
    });
  });

  it('fails when every product refuses, in each driver’s own words', async () => {
    probeRefusals = {
      jira: 'Authentication failed — check the account email and API token.',
      confluence: 'Authentication failed — check the account email and API token.',
    };
    const got = await request(app)
      .post('/api/connections/atlassian/test')
      .send(ACCOUNT)
      .expect(200);
    expect(got.body).toEqual({
      ok: false,
      products: {
        jira: { ok: false, error: probeRefusals.jira },
        confluence: { ok: false, error: probeRefusals.confluence },
      },
    });
  });

  it('asks for what is missing rather than probing half a connection', async () => {
    const got = await request(app)
      .post('/api/connections/atlassian/test')
      .send({ baseUrl: '', accountEmail: '', apiToken: '' })
      .expect(400);
    expect(got.body.error).toMatch(/Fill in the site URL/);
    expect(probes).toEqual([]);
  });
});

describe('removing a connection', () => {
  it('pauses every kind it served, keeping their documents', async () => {
    await request(app).put('/api/connections/atlassian').send(ACCOUNT).expect(200);
    await context.createSource(ORG, {
      id: 'jira-acme-atlassian-net-eng',
      kind: 'jira',
      title: 'ENG (Jira)',
      config: { projectKey: 'ENG' },
    });
    await context.writeDocuments(ORG, 'jira-acme-atlassian-net-eng', {
      documents: [
        {
          docId: '10001',
          docPath: 'ENG-1.md',
          title: 'ENG-1: Orders',
          url: null,
          contentHash: 'abc',
          updatedAt: '2026-09-01T10:00:00.000Z',
          body: '# ENG-1: Orders',
        },
      ],
      removed: [],
    });
    // The same account's other product, which the one removal must take too.
    await context.createSource(ORG, {
      id: 'confluence-acme-atlassian-net-eng',
      kind: 'confluence',
      title: 'ENG (Confluence)',
      config: { spaceKey: 'ENG' },
    });
    // A site of the same workspace has nothing to do with this account.
    await context.createSource(ORG, {
      id: 'site-docs-acme',
      kind: 'site',
      title: 'docs.acme.com',
      config: { llmsTxtUrl: 'https://docs.acme.com/llms.txt' },
    });

    const got = await request(app).delete('/api/connections/atlassian').expect(200);
    expect(got.body.paused).toEqual([
      'jira-acme-atlassian-net-eng',
      'confluence-acme-atlassian-net-eng',
    ]);
    expect(got.body.connection.connected).toBe(false);

    const paused = await context.getSource(ORG, 'jira-acme-atlassian-net-eng');
    expect(paused).toMatchObject({ status: 'paused' });
    expect(paused!.statusNote).toMatch(
      /Atlassian connection this source reads through was removed/,
    );
    expect(await context.getSource(ORG, 'confluence-acme-atlassian-net-eng')).toMatchObject({
      status: 'paused',
    });
    // The documents stay: reconnecting is a Resume, not a re-add.
    expect(await context.listDocuments(ORG, 'jira-acme-atlassian-net-eng')).toHaveLength(1);
    // And the site is untouched.
    expect(await context.getSource(ORG, 'site-docs-acme')).toMatchObject({ status: 'never' });

    expect(await store.getConnection(ORG, 'atlassian')).toBeNull();
    expect(captured).toEqual([
      { event: 'connection_saved', properties: { provider: 'atlassian' } },
      { event: 'connection_removed', properties: { provider: 'atlassian' } },
    ]);
    expect(changes).toEqual([{ org: ORG, change: 'sources' }]);
  });

  it('is a no-op on an account nothing connected, and announces nothing', async () => {
    const got = await request(app).delete('/api/connections/atlassian').expect(200);
    expect(got.body).toEqual({
      connection: {
        provider: 'atlassian',
        kinds: ['jira', 'confluence'],
        connected: false,
        baseUrl: '',
        accountEmail: '',
        tokenMask: null,
        updatedAt: null,
      },
      paused: [],
    });
    expect(changes).toEqual([]);
  });
});

describe('the connection a driver reads with', () => {
  it('is the one decrypted account both products read, and a refusal in a reader’s words', async () => {
    await expect(store.requireConnection(ORG, 'atlassian')).rejects.toThrow(
      /This workspace has no Atlassian connection\. Connect the account in Settings › Connections\./,
    );
    // A ContextConfigError: the routes answer it as a 400 and a sync records it
    // as the source's own note, rather than either reading as a server fault.
    await expect(store.requireConnection(ORG, 'atlassian')).rejects.toMatchObject({
      name: 'ConnectionMissingError',
    });

    await request(app).put('/api/connections/atlassian').send(ACCOUNT).expect(200);
    // The Jira driver and the Confluence driver look the same row up.
    expect(await store.requireConnection(ORG, 'atlassian')).toEqual({
      baseUrl: 'https://acme.atlassian.net',
      accountEmail: 'u@acme.test',
      apiToken: 'super-secret-token',
    });
  });
});
