/**
 * The Models settings API: the workspace's provider, read masked and written
 * only after the provider itself has answered. Driven over the real Postgres
 * store (PGlite) so "a rejected config saves nothing" is asserted against rows,
 * not against a spy.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { Express } from 'express';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { LLM_PROVIDER_KINDS } from '@truecourse/shared';
import { PgLlmConfigStore } from '../../packages/data-store/src/index';
import { createTestApp, TEST_ORG, testAuthVerifier } from '../helpers/test-app';
import {
  resetWorkspaceLlmBackend,
  resetWorkspaceLlmConfigStore,
  setWorkspaceLlmBackend,
  setWorkspaceLlmConfigStore,
} from '../../apps/dashboard/server/src/services/workspace-llm.service';

const SECRET = 'master-secret-at-least-32-chars-long!!';
const OTHER_ORG = 'org_other';

let client: PGlite;
let store: PgLlmConfigStore;
let app: Express;
let probe: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  store = new PgLlmConfigStore(db as unknown as Db, SECRET);
  probe = vi.fn(async () => {});
  app = createTestApp();
  // After createTestApp — it installs the permissive default this suite replaces.
  setWorkspaceLlmConfigStore(store);
  setWorkspaceLlmBackend({ probe: probe as never });
});

afterEach(async () => {
  resetWorkspaceLlmBackend();
  resetWorkspaceLlmConfigStore();
  await client.close();
});

describe('GET /api/llm/config', () => {
  it('answers with a null config and the provider kinds until one is set', async () => {
    const res = await request(app).get('/api/llm/config').expect(200);
    expect(res.body).toEqual({ config: null, providers: [...LLM_PROVIDER_KINDS] });
  });

  it('answers with the masked view once one is set, never the key', async () => {
    await store.save(TEST_ORG, { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-secret99' });

    const res = await request(app).get('/api/llm/config').expect(200);
    expect(res.body.config).toMatchObject({
      provider: 'anthropic',
      model: 'claude-x',
      hasKey: true,
      keyMask: '••••et99',
    });
    expect(JSON.stringify(res.body)).not.toContain('sk-secret99');
  });

  it('reads the CALLER’s workspace — another workspace’s provider is not visible', async () => {
    await store.save(OTHER_ORG, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-other' });

    const res = await request(app).get('/api/llm/config').expect(200);
    expect(res.body.config).toBeNull();
  });
});

describe('PATCH /api/llm/config', () => {
  const body = { provider: 'anthropic', model: 'claude-x', apiKey: 'sk-new1234' };

  it('probes the candidate, then saves it and answers with the masked view', async () => {
    const res = await request(app).patch('/api/llm/config').send(body).expect(200);

    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe.mock.calls[0][0]).toMatchObject({
      provider: 'anthropic',
      model: 'claude-x',
      apiKey: 'sk-new1234',
    });
    expect(res.body.config).toMatchObject({ model: 'claude-x', hasKey: true, keyMask: '••••1234' });
    expect(await store.getConfig(TEST_ORG)).toMatchObject({ apiKey: 'sk-new1234' });
  });

  it('saves NOTHING when the provider refuses the probe', async () => {
    probe.mockRejectedValueOnce(new Error('401 invalid x-api-key'));

    const res = await request(app).patch('/api/llm/config').send(body).expect(400);
    expect(res.body.error).toContain('401 invalid x-api-key');
    expect(await store.getConfig(TEST_ORG)).toBeNull();
  });

  it('leaves the existing config intact when a replacement fails its probe', async () => {
    await request(app).patch('/api/llm/config').send(body).expect(200);
    probe.mockRejectedValueOnce(new Error('model not found'));

    await request(app)
      .patch('/api/llm/config')
      .send({ provider: 'anthropic', model: 'claude-typo', apiKey: 'sk-other999' })
      .expect(400);

    expect(await store.getConfig(TEST_ORG)).toMatchObject({
      model: 'claude-x',
      apiKey: 'sk-new1234',
    });
  });

  it('probes with the stored key when the form omits it on the same provider', async () => {
    await request(app).patch('/api/llm/config').send(body).expect(200);

    await request(app)
      .patch('/api/llm/config')
      .send({ provider: 'anthropic', model: 'claude-y' })
      .expect(200);

    expect(probe.mock.calls[1][0]).toMatchObject({ model: 'claude-y', apiKey: 'sk-new1234' });
    expect(await store.getConfig(TEST_ORG)).toMatchObject({
      model: 'claude-y',
      apiKey: 'sk-new1234',
    });
  });

  it('refuses a keyless non-bedrock provider before it probes anything', async () => {
    const res = await request(app)
      .patch('/api/llm/config')
      .send({ provider: 'anthropic', model: 'claude-x' })
      .expect(400);

    expect(res.body.error).toMatch(/API key is required/);
    expect(probe).not.toHaveBeenCalled();
  });

  it('rejects an unknown provider', async () => {
    await request(app)
      .patch('/api/llm/config')
      .send({ provider: 'mistral', model: 'm', apiKey: 'k' })
      .expect(400);
    expect(probe).not.toHaveBeenCalled();
  });

  it('writes only the caller’s workspace', async () => {
    await store.save(OTHER_ORG, { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-other' });

    await request(app).patch('/api/llm/config').send(body).expect(200);

    expect(await store.getConfig(OTHER_ORG)).toMatchObject({ model: 'gpt-4o', apiKey: 'sk-other' });
    expect(await store.getConfig(TEST_ORG)).toMatchObject({ model: 'claude-x' });
  });

  it('is reachable by any authenticated member — there is no separate admin gate', async () => {
    const memberApp = createTestApp({ authVerifier: testAuthVerifier(TEST_ORG) });
    setWorkspaceLlmConfigStore(store);
    setWorkspaceLlmBackend({ probe: probe as never });
    await request(memberApp).patch('/api/llm/config').send(body).expect(200);
  });
});
