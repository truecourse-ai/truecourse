/**
 * Settings › Connections, over the real routes and the real store (PGlite + the
 * drizzle migrations).
 *
 * What is pinned: a connection is the ACCOUNT and the page only ever sees it
 * masked, a re-save that leaves the token blank keeps the stored one, Test runs
 * the read a sync makes with the submitted token or the stored one, removing a
 * connection PAUSES the sources that read through it without touching their
 * documents, and both mutations report themselves as one product action each.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express, { type Express } from 'express';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { MIGRATIONS_DIR, schema, type Db } from '@truecourse/db';
import type { ContextConnectionProvider } from '@truecourse/shared';
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
/** Every probe the Test route ran, with the credentials it settled on. */
let probes: { provider: ContextConnectionProvider; connection: AtlassianConnection }[];
/** What the next probe does: resolve, or refuse with this reason. */
let probeRefusal: string | null;
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
  probeRefusal = null;
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
      probe: async (provider, connection) => {
        probes.push({ provider, connection });
        if (probeRefusal) throw new Error(probeRefusal);
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

const JIRA = {
  baseUrl: 'https://acme.atlassian.net',
  accountEmail: 'u@acme.test',
  apiToken: 'super-secret-token',
};

describe('the connections listing', () => {
  it('lists every tool, connected or not, and never the token', async () => {
    const got = await request(app).get('/api/connections').expect(200);
    expect(got.body.connections).toEqual([
      {
        provider: 'jira',
        connected: false,
        baseUrl: '',
        accountEmail: '',
        tokenMask: null,
        updatedAt: null,
      },
      {
        provider: 'confluence',
        connected: false,
        baseUrl: '',
        accountEmail: '',
        tokenMask: null,
        updatedAt: null,
      },
    ]);
  });

  it('shows a connected tool masked: the account, and the token’s last four', async () => {
    await request(app).put('/api/connections/jira').send(JIRA).expect(200);
    const got = await request(app).get('/api/connections').expect(200);
    const jira = got.body.connections.find(
      (connection: { provider: string }) => connection.provider === 'jira',
    );
    expect(jira).toMatchObject({
      provider: 'jira',
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
    await request(app).put('/api/connections/jira').send(JIRA).expect(200);
    expect(await store.getConnection(ORG, 'jira')).toEqual({
      baseUrl: 'https://acme.atlassian.net',
      accountEmail: 'u@acme.test',
      apiToken: 'super-secret-token',
    });
    expect(captured).toEqual([{ event: 'connection_saved', properties: { provider: 'jira' } }]);
  });

  it('keeps the stored token when a re-save leaves the field blank', async () => {
    await request(app).put('/api/connections/jira').send(JIRA).expect(200);
    await request(app)
      .put('/api/connections/jira')
      .send({ baseUrl: 'https://acme.atlassian.net/', accountEmail: 'other@acme.test' })
      .expect(200);
    expect(await store.getConnection(ORG, 'jira')).toEqual({
      // The trailing slash is normalized away, so a path is never doubled.
      baseUrl: 'https://acme.atlassian.net',
      accountEmail: 'other@acme.test',
      apiToken: 'super-secret-token',
    });
  });

  it('refuses a first connection with no token, and an unusable site URL', async () => {
    const tokenless = await request(app)
      .put('/api/connections/jira')
      .send({ baseUrl: JIRA.baseUrl, accountEmail: JIRA.accountEmail })
      .expect(400);
    expect(tokenless.body.error).toMatch(/API token is required/);

    const badUrl = await request(app)
      .put('/api/connections/jira')
      .send({ ...JIRA, baseUrl: 'acme.atlassian.net' })
      .expect(400);
    expect(badUrl.body.error).toMatch(/full URL/);
    expect(captured).toEqual([]);
  });

  it('refuses a tool that has no connection of its own', async () => {
    await request(app).put('/api/connections/notion').send(JIRA).expect(404);
  });

  it('keeps one workspace’s connection out of another’s', async () => {
    await request(app).put('/api/connections/jira').send(JIRA).expect(200);
    expect(await store.getConnection('org_other', 'jira')).toBeNull();
  });
});

describe('testing a connection', () => {
  it('runs the probe with the submitted token', async () => {
    await request(app)
      .post('/api/connections/jira/test')
      .send(JIRA)
      .expect(200, { ok: true });
    expect(probes).toEqual([{ provider: 'jira', connection: JIRA }]);
  });

  it('runs it with the STORED token when the field was left masked', async () => {
    await request(app).put('/api/connections/jira').send(JIRA).expect(200);
    await request(app)
      .post('/api/connections/jira/test')
      .send({ baseUrl: JIRA.baseUrl, accountEmail: JIRA.accountEmail })
      .expect(200, { ok: true });
    expect(probes[0]!.connection.apiToken).toBe('super-secret-token');
  });

  it('answers the reason the driver gave, and nothing of its own', async () => {
    probeRefusal = 'Authentication failed — check the account email and API token.';
    const got = await request(app).post('/api/connections/jira/test').send(JIRA).expect(400);
    expect(got.body).toEqual({ ok: false, error: probeRefusal });
  });

  it('asks for what is missing rather than probing half a connection', async () => {
    const got = await request(app)
      .post('/api/connections/confluence/test')
      .send({ baseUrl: '', accountEmail: '', apiToken: '' })
      .expect(400);
    expect(got.body.error).toMatch(/Fill in the site URL/);
    expect(probes).toEqual([]);
  });
});

describe('removing a connection', () => {
  it('pauses the sources that read through it, keeping their documents', async () => {
    await request(app).put('/api/connections/jira').send(JIRA).expect(200);
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
    // A site of the same workspace has nothing to do with this account.
    await context.createSource(ORG, {
      id: 'site-docs-acme',
      kind: 'site',
      title: 'docs.acme.com',
      config: { llmsTxtUrl: 'https://docs.acme.com/llms.txt' },
    });

    const got = await request(app).delete('/api/connections/jira').expect(200);
    expect(got.body.paused).toEqual(['jira-acme-atlassian-net-eng']);
    expect(got.body.connection.connected).toBe(false);

    const paused = await context.getSource(ORG, 'jira-acme-atlassian-net-eng');
    expect(paused).toMatchObject({ status: 'paused' });
    expect(paused!.statusNote).toMatch(/Jira connection this source reads through was removed/);
    // The documents stay: reconnecting is a Resume, not a re-add.
    expect(await context.listDocuments(ORG, 'jira-acme-atlassian-net-eng')).toHaveLength(1);
    // And the site is untouched.
    expect(await context.getSource(ORG, 'site-docs-acme')).toMatchObject({ status: 'never' });

    expect(await store.getConnection(ORG, 'jira')).toBeNull();
    expect(captured).toEqual([
      { event: 'connection_saved', properties: { provider: 'jira' } },
      { event: 'connection_removed', properties: { provider: 'jira' } },
    ]);
    expect(changes).toEqual([{ org: ORG, change: 'sources' }]);
  });

  it('is a no-op on a tool nothing connected, and announces nothing', async () => {
    const got = await request(app).delete('/api/connections/confluence').expect(200);
    expect(got.body).toEqual({
      connection: {
        provider: 'confluence',
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
  it('is the decrypted account, and a refusal in a reader’s words when there is none', async () => {
    await expect(store.requireConnection(ORG, 'jira')).rejects.toThrow(
      /This workspace has no Jira connection\. Connect the account in Settings › Connections\./,
    );
    // A ContextConfigError: the routes answer it as a 400 and a sync records it
    // as the source's own note, rather than either reading as a server fault.
    await expect(store.requireConnection(ORG, 'confluence')).rejects.toMatchObject({
      name: 'ConnectionMissingError',
    });

    await request(app).put('/api/connections/jira').send(JIRA).expect(200);
    expect(await store.requireConnection(ORG, 'jira')).toEqual({
      baseUrl: 'https://acme.atlassian.net',
      accountEmail: 'u@acme.test',
      apiToken: 'super-secret-token',
    });
  });
});
