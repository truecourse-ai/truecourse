import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';

/**
 * The externals routes — `GET /guard/externals` (the joined view) and
 * `PUT /guard/externals` (the declaration write). Real engine, real files, real
 * temp repo: the whole point of this pair is what lands on disk, so nothing here
 * is mocked except the socket emitter.
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

describe('Guard externals routes', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const write = (rel: string, content: string) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  const writeJson = (rel: string, obj: unknown) => write(rel, JSON.stringify(obj, null, 2) + '\n');
  const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
  const url = () => `/api/repos/${fixture.project.slug}/guard/externals`;
  const RECIPE = '.truecourse/scenarios/recipe.json';
  const LOCAL = '.truecourse/scenarios/externals.local.json';

  const seedRecipe = () =>
    writeJson(RECIPE, {
      build: 'true',
      api: { serve: ['node', 'server.mjs'], healthPath: '/health' },
    });

  beforeEach(async () => {
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    vi.mocked(emitSpecComplete).mockClear();
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET answers an empty view on a repo with nothing configured', async () => {
    const res = await request(app).get(url()).expect(200);
    expect(res.body).toMatchObject({
      services: [],
      recipeValid: false,
      detectionAvailable: false,
      generateAvailable: false,
      unknownLocalServices: [],
    });
  });

  // The page filters on these two, so a route that drops them renders every detected
  // service as a chore again.
  it('GET carries the relevance flag and generateAvailable over the wire', async () => {
    writeJson(RECIPE, {
      build: 'true',
      api: {
        serve: ['node', 'server.mjs'],
        externals: {
          // Touched by a human (a base URL) ⇒ relevant; skeleton-only ⇒ not.
          'open-meteo': { baseUrlEnv: 'GEO_BASE', baseUrl: 'https://sandbox.test' },
          stripe: { baseUrlEnv: 'STRIPE_BASE_URL', description: 'detected in src/pay.ts' },
        },
      },
    });
    writeJson('.truecourse/scenarios/manifest.json', { version: 2, flows: [] });

    const res = await request(app).get(url()).expect(200);
    expect(res.body.generateAvailable).toBe(true);
    expect(
      Object.fromEntries(
        (res.body.services as { service: string; relevant: boolean }[]).map((s) => [s.service, s.relevant]),
      ),
    ).toEqual({ 'open-meteo': true, stripe: false });
  });

  it('GET joins the declaration with its resolution state', async () => {
    writeJson(RECIPE, {
      build: 'true',
      api: {
        serve: ['node', 'server.mjs'],
        externals: { 'open-meteo': { baseUrlEnv: 'GEO_BASE', baseUrl: 'https://sandbox.test', mode: 'sandbox' } },
      },
    });
    const res = await request(app).get(url()).expect(200);
    expect(res.body.services).toHaveLength(1);
    expect(res.body.services[0]).toMatchObject({
      service: 'open-meteo',
      declared: true,
      detected: false,
      state: 'provided',
      baseUrl: 'https://sandbox.test',
      blockedFlows: 0,
    });
  });

  it('PUT writes the declaration to the recipe, the secret to the overlay, and emits', async () => {
    seedRecipe();
    const res = await request(app)
      .put(url())
      .send({
        externals: {
          'open-meteo': {
            baseUrlEnv: 'GEO_BASE',
            baseUrl: 'https://sandbox.test',
            mode: 'sandbox',
            env: { GEO_KEY: { value: 'sk-secret' } },
          },
        },
      })
      .expect(200);

    // The response IS the fresh view — no follow-up GET needed.
    expect(res.body.services[0]).toMatchObject({ service: 'open-meteo', state: 'provided' });
    expect(readJson(RECIPE).api.externals['open-meteo']).toEqual({
      baseUrlEnv: 'GEO_BASE',
      baseUrl: 'https://sandbox.test',
      mode: 'sandbox',
      env: { GEO_KEY: {} },
    });
    expect(fs.readFileSync(path.join(root, RECIPE), 'utf-8')).not.toContain('sk-secret');
    expect(readJson(LOCAL)).toEqual({ 'open-meteo': { env: { GEO_KEY: 'sk-secret' } } });
    expect(vi.mocked(emitSpecComplete)).toHaveBeenCalledWith(fixture.project.slug, 'guard-externals');
  });

  it('PUT removes a service with null', async () => {
    seedRecipe();
    await request(app)
      .put(url())
      .send({ externals: { svc: { baseUrlEnv: 'B', baseUrl: 'https://b.test' } } })
      .expect(200);
    const res = await request(app).put(url()).send({ externals: { svc: null } }).expect(200);
    expect(res.body.services).toEqual([]);
    expect(readJson(RECIPE).api.externals).toBeUndefined();
  });

  it('PUT rejects a malformed body with 400 and a refused write with 422', async () => {
    seedRecipe();
    await request(app).put(url()).send({}).expect(400);
    await request(app).put(url()).send({ externals: [] }).expect(400);

    // A declaration the recipe schema would refuse (no baseUrlEnv) → 422, not 500.
    const bad = await request(app)
      .put(url())
      .send({ externals: { svc: { baseUrl: 'https://b.test' } } })
      .expect(422);
    expect(bad.body.error).toContain('invalid');
    expect(vi.mocked(emitSpecComplete)).not.toHaveBeenCalled();
  });

  it('PUT without a recipe is a 422 pointing at `guard setup`', async () => {
    const res = await request(app)
      .put(url())
      .send({ externals: { svc: { baseUrlEnv: 'B' } } })
      .expect(422);
    expect(res.body.error).toContain('guard setup');
  });
});
