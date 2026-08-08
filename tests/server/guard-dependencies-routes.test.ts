import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';

/**
 * The dependencies routes — `GET /guard/dependencies` (the joined catalog view),
 * `PUT /guard/dependencies` (register ONE instance) and `GET
 * /guard/dependency/raw` (the committed catalog entry behind a row). Real engine,
 * real files, real temp repo: what lands on disk is the whole point, so nothing
 * here is mocked except the socket emitter.
 */

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
  };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import { emitSpecComplete } from '../../apps/dashboard/server/src/socket/handlers';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

describe('Guard dependencies routes', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const writeJson = (rel: string, obj: unknown) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n');
  };
  const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
  const url = () => `/api/repos/${fixture.project.slug}/guard/dependencies`;
  const rawUrl = (name: string) =>
    `/api/repos/${fixture.project.slug}/guard/dependency/raw?id=${encodeURIComponent(name)}`;

  const CATALOG = '.truecourse/scenarios/dependencies.json';
  const LOCAL = '.truecourse/scenarios/dependencies.local.json';
  const RECIPE = '.truecourse/scenarios/recipe.json';
  const EXTERNALS_LOCAL = '.truecourse/scenarios/externals.local.json';

  const ACCOUNT = {
    name: 'anthropic',
    class: 'supplied',
    services: ['anthropic'],
    summary: 'an Anthropic account the LLM rules run against',
    registration: {
      kind: 'env',
      vars: [{ name: 'ANTHROPIC_API_KEY', description: 'the credential', secret: true }],
    },
    needs: [{ flowId: 'run-llm-rules', need: 'a key with model access' }],
  };

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    vi.mocked(emitSpecComplete).mockClear();
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET answers an honest empty view on a repo with nothing declared', async () => {
    const res = await request(app).get(url()).expect(200);
    expect(res.body).toMatchObject({
      dependencies: [],
      detectionAvailable: false,
      invalidReason: null,
      unknownLocalNames: [],
    });
  });

  it('GET joins the catalog entry with its state and its attributed requirement', async () => {
    writeJson(CATALOG, { dependencies: [ACCOUNT] });
    const res = await request(app).get(url()).expect(200);
    expect(res.body.dependencies).toHaveLength(1);
    expect(res.body.dependencies[0]).toMatchObject({
      name: 'anthropic',
      class: 'supplied',
      state: 'unprovided',
      requirement: 'a key with model access',
      needs: [{ flowId: 'run-llm-rules', need: 'a key with model access' }],
      registration: { kind: 'env' },
      inCatalog: true,
    });
  });

  it('PUT registers the instance in the GITIGNORED overlay, emits, and echoes no value', async () => {
    writeJson(CATALOG, { dependencies: [ACCOUNT] });
    const res = await request(app)
      .put(url())
      .send({ name: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-secret' } })
      .expect(200);

    // The response IS the fresh view — no follow-up GET needed.
    expect(res.body.dependencies[0]).toMatchObject({ name: 'anthropic', state: 'provided' });
    expect(JSON.stringify(res.body)).not.toContain('sk-secret');
    expect(readJson(LOCAL)).toEqual({ anthropic: { env: { ANTHROPIC_API_KEY: 'sk-secret' } } });
    // The committed catalog is untouched: the declaration already said all of this.
    expect(readJson(CATALOG).dependencies).toEqual([ACCOUNT]);
    expect(vi.mocked(emitSpecComplete)).toHaveBeenCalledWith(fixture.project.slug, 'guard-externals');
  });

  /**
   * A SERVICE row's account: the origin the team shares, and the transport detail
   * one machine holds. The split is the point — the token and the headers are
   * secrets, so they land in the gitignored overlay and the committed recipe never
   * sees them, and neither does the response.
   */
  it('PUT stores a service’s token and headers locally, and echoes neither secret back', async () => {
    writeJson(RECIPE, {
      build: 'true',
      api: {
        serve: ['node', 'server.mjs'],
        externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL' } },
      },
    });

    const res = await request(app)
      .put(url())
      .send({
        name: 'stripe',
        baseUrlEnv: 'STRIPE_BASE_URL',
        baseUrl: 'https://api.stripe.test',
        token: 'sk_live_secret',
        headers: { 'X-Tenant': 'acme', 'X-Api-Key': 'hk_secret' },
      })
      .expect(200);

    expect(readJson(EXTERNALS_LOCAL)).toEqual({
      stripe: {
        token: 'sk_live_secret',
        headers: { 'X-Api-Key': 'hk_secret', 'X-Tenant': 'acme' },
      },
    });
    // The committed half carries the declaration and nothing else.
    expect(fs.readFileSync(path.join(root, RECIPE), 'utf-8')).not.toContain('sk_live_secret');
    expect(JSON.stringify(res.body)).not.toContain('sk_live_secret');
    expect(JSON.stringify(res.body)).not.toContain('hk_secret');

    // What the view DOES say: a token is registered, and which headers exist — the
    // readable one with its value, the credential-shaped one without.
    const service = res.body.dependencies[0].service;
    expect(service).toMatchObject({ tokenSet: true, baseUrl: 'https://api.stripe.test' });
    expect(service.headers).toEqual([
      { name: 'X-Api-Key', secret: true },
      { name: 'X-Tenant', secret: false, value: 'acme' },
    ]);
  });

  it('PUT keeps an untouched token, and drops the header a later write omits', async () => {
    writeJson(RECIPE, {
      build: 'true',
      api: { serve: ['node', 'server.mjs'], externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL' } } },
    });
    writeJson(EXTERNALS_LOCAL, {
      stripe: { token: 'sk_live_secret', headers: { 'X-Tenant': 'acme' } },
    });

    // A patch that says nothing about the token leaves it exactly as it was: the
    // page cannot echo a stored secret, so a blank field can only mean "unchanged".
    const res = await request(app)
      .put(url())
      .send({ name: 'stripe', baseUrlEnv: 'STRIPE_BASE_URL', headers: { 'X-Tenant': null } })
      .expect(200);

    expect(readJson(EXTERNALS_LOCAL)).toEqual({ stripe: { token: 'sk_live_secret' } });
    expect(res.body.dependencies[0].service).toMatchObject({ tokenSet: true, headers: [] });
  });

  it('PUT refuses a header name HTTP does not allow, rather than writing a file nothing can read', async () => {
    writeJson(RECIPE, {
      build: 'true',
      api: { serve: ['node', 'server.mjs'], externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL' } } },
    });
    const res = await request(app)
      .put(url())
      .send({ name: 'stripe', baseUrlEnv: 'STRIPE_BASE_URL', headers: { 'X Tenant: nope': 'acme' } })
      .expect(422);
    expect(res.body.error).toContain('header name');
    expect(fs.existsSync(path.join(root, EXTERNALS_LOCAL))).toBe(false);
  });

  it('PUT rejects a body with no name (400) and an undeclared variable (422)', async () => {
    writeJson(CATALOG, { dependencies: [ACCOUNT] });
    await request(app).put(url()).send({ env: { A: 'b' } }).expect(400);

    const refused = await request(app)
      .put(url())
      .send({ name: 'anthropic', env: { SNEAKY: 'x' } })
      .expect(422);
    expect(refused.body.error).toContain('SNEAKY');
    expect(fs.existsSync(path.join(root, LOCAL))).toBe(false);
    expect(vi.mocked(emitSpecComplete)).not.toHaveBeenCalled();
  });

  it('PUT refuses a dependency nothing declares, rather than inventing one', async () => {
    const res = await request(app).put(url()).send({ name: 'ghost', path: '/tmp' }).expect(422);
    expect(res.body.error).toContain('No dependency named');
  });

  it('the raw route answers ONE catalog entry, keyed by its name', async () => {
    writeJson(CATALOG, { dependencies: [ACCOUNT] });
    const res = await request(app).get(rawUrl('anthropic')).expect(200);
    expect(res.body).toMatchObject({
      id: 'anthropic',
      file: path.join('.truecourse', 'scenarios', 'dependencies.json'),
    });
    expect(JSON.parse(res.body.content)).toEqual(ACCOUNT);

    // A name the catalog does not carry is a 404, never an empty document.
    await request(app).get(rawUrl('ghost')).expect(404);
  });

  it('the raw route never exposes the gitignored overlay', async () => {
    writeJson(CATALOG, { dependencies: [ACCOUNT] });
    writeJson(LOCAL, { anthropic: { env: { ANTHROPIC_API_KEY: 'sk-secret' } } });
    const res = await request(app).get(rawUrl('anthropic')).expect(200);
    expect(res.body.content).not.toContain('sk-secret');
  });
});
