/**
 * The dependencies routes of a HOSTED repository — no working tree, the catalog
 * in the setup bundle, the registered instances in an encrypted row. Driven over
 * the real Postgres stores (PGlite): what is pinned is the composition over the
 * scratch tree, the isolation from the server's own environment, the hosted
 * refusals (a path, a recipe edit), and that a registration lands in the row
 * masked on the wire and in clear only in the store.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
  };
});

import { PgGuardStore, PgGuardOverlayStore } from '../../packages/data-store/src/index';
import { setGuardStore, resetGuardStore, saveGuardSetupBundle } from '@truecourse/core/lib/guard-store';
import {
  setGuardOverlayStore,
  resetGuardOverlayStore,
  readGuardOverlays,
  writeGuardOverlays,
} from '@truecourse/core/lib/guard-overlays';
import { createTestApp } from '../helpers/test-app';
import { emitSpecComplete } from '../../apps/dashboard/server/src/socket/handlers';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

const SECRET = 'master-secret-at-least-32-chars-long!!';

const ACCOUNT = {
  name: 'anthropic',
  class: 'supplied',
  services: ['anthropic'],
  summary: 'an Anthropic account the LLM rules run against',
  registration: {
    kind: 'env',
    vars: [
      { name: 'ANTHROPIC_BASE_URL', description: 'the base URL', secret: false },
      { name: 'ANTHROPIC_API_KEY', description: 'the credential', secret: true },
    ],
  },
  needs: [{ flowId: 'run-llm-rules', need: 'a key with model access' }],
};

const PROJECT_DIR = {
  name: 'sample-project',
  class: 'supplied',
  summary: 'a real project checkout the program is pointed at',
  registration: { kind: 'path', description: 'a directory holding a project' },
  needs: [],
};

const RECIPE = {
  build: 'true',
  api: {
    serve: ['node', 'server.mjs'],
    externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL', env: { STRIPE_KEY: {} } } },
  },
};

describe('Guard dependencies routes — hosted', () => {
  let app: Express;
  let fixture: TestFixture;
  let client: PGlite;
  /** The repo KEY: the registry's path string, which the hosted stores key by. */
  let repoKey: string;

  const url = () => `/api/repos/${fixture.project.slug}/guard/dependencies`;
  const rawUrl = (name: string) =>
    `/api/repos/${fixture.project.slug}/guard/dependency/raw?id=${encodeURIComponent(name)}`;

  const bundle = async (files: Record<string, unknown>) =>
    saveGuardSetupBundle(
      { repoKey, commitSha: 'setup-commit' },
      Object.fromEntries(Object.entries(files).map(([rel, body]) => [rel, JSON.stringify(body, null, 2) + '\n'])),
    );

  beforeEach(async () => {
    fixture = await setupTestFixture();
    repoKey = fixture.repoPath;
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    setGuardStore(new PgGuardStore(db as unknown as Db));
    setGuardOverlayStore(new PgGuardOverlayStore(db as unknown as Db, SECRET));
    vi.mocked(emitSpecComplete).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    resetGuardStore();
    resetGuardOverlayStore();
    delete process.env.ANTHROPIC_API_KEY;
    await client.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET answers an honest empty view before setup has stored anything', async () => {
    const res = await request(app).get(url()).expect(200);
    expect(res.body).toMatchObject({ dependencies: [], detectionAvailable: false, invalidReason: null });
    // Never a server path: the files are named the way the bundle names them.
    expect(res.body.catalogPath).toBe('.truecourse/scenarios/dependencies.json');
    expect(res.body.recipePath).toBe('.truecourse/scenarios/recipe.json');
  });

  it('GET composes the stored catalog with the stored instances, masked', async () => {
    await bundle({ '.truecourse/scenarios/dependencies.json': { dependencies: [ACCOUNT] } });
    await writeGuardOverlays(repoKey, {
      dependencies: {
        anthropic: { env: { ANTHROPIC_BASE_URL: 'https://llm.internal', ANTHROPIC_API_KEY: 'sk-test-not-real' } },
      },
      externals: {},
    });

    const res = await request(app).get(url()).expect(200);
    expect(res.body.dependencies[0]).toMatchObject({ name: 'anthropic', state: 'provided', inCatalog: true });
    expect(res.body.dependencies[0].fields.map((f: { value?: string }) => f.value)).toEqual([
      'https://llm.internal',
      `${'•'.repeat(12)} (stored locally, masked)`,
    ]);
    expect(JSON.stringify(res.body)).not.toContain('sk-test-not-real');
  });

  it('GET never resolves a variable from the server’s own environment', async () => {
    await bundle({
      '.truecourse/scenarios/dependencies.json': { dependencies: [ACCOUNT] },
      '.truecourse/scenarios/recipe.json': RECIPE,
    });
    process.env.ANTHROPIC_API_KEY = 'sk-from-the-server';
    process.env.STRIPE_KEY = 'sk_from_the_server';
    try {
      const res = await request(app).get(url()).expect(200);
      const byName = Object.fromEntries(
        (res.body.dependencies as { name: string; state: string }[]).map((d) => [d.name, d.state]),
      );
      expect(byName).toEqual({ anthropic: 'unprovided', stripe: 'unprovided' });
      expect(JSON.stringify(res.body)).not.toContain('from_the_server');
    } finally {
      delete process.env.STRIPE_KEY;
    }
  });

  it('GET reads a host-path registration as unregistrable here, with the reason', async () => {
    await bundle({ '.truecourse/scenarios/dependencies.json': { dependencies: [PROJECT_DIR] } });
    const res = await request(app).get(url()).expect(200);
    expect(res.body.dependencies[0]).toMatchObject({ name: 'sample-project', state: 'unprovided' });
    expect(res.body.dependencies[0].fields[0]).toMatchObject({
      field: 'path',
      resolved: false,
      reason: expect.stringContaining('register it where the scenarios run'),
    });
  });

  it('PUT stores the instance in the encrypted row, emits, and answers the masked view', async () => {
    await bundle({ '.truecourse/scenarios/dependencies.json': { dependencies: [ACCOUNT] } });
    const res = await request(app)
      .put(url())
      .send({ name: 'anthropic', env: { ANTHROPIC_BASE_URL: 'https://llm.internal', ANTHROPIC_API_KEY: 'sk-test-not-real' } })
      .expect(200);

    expect(res.body.dependencies[0]).toMatchObject({ name: 'anthropic', state: 'provided' });
    expect(JSON.stringify(res.body)).not.toContain('sk-test-not-real');
    expect(res.body.localPath).toBe('.truecourse/scenarios/dependencies.local.json');
    expect(await readGuardOverlays(repoKey)).toEqual({
      dependencies: {
        anthropic: { env: { ANTHROPIC_API_KEY: 'sk-test-not-real', ANTHROPIC_BASE_URL: 'https://llm.internal' } },
      },
      externals: {},
    });
    expect(vi.mocked(emitSpecComplete)).toHaveBeenCalledWith(fixture.project.slug, 'guard-externals');

    // A later write layers over the stored row — the untouched variable survives.
    await request(app).put(url()).send({ name: 'anthropic', env: { ANTHROPIC_API_KEY: 'sk-rotated' } }).expect(200);
    expect((await readGuardOverlays(repoKey))?.dependencies.anthropic?.env).toEqual({
      ANTHROPIC_API_KEY: 'sk-rotated',
      ANTHROPIC_BASE_URL: 'https://llm.internal',
    });
  });

  it('PUT keeps a recipe-declared service’s origin and secrets in the overlay half', async () => {
    await bundle({ '.truecourse/scenarios/recipe.json': RECIPE });
    const res = await request(app)
      .put(url())
      .send({
        name: 'stripe',
        baseUrlEnv: 'STRIPE_BASE_URL',
        baseUrl: 'https://api.stripe.test',
        env: { STRIPE_KEY: 'sk_live_not_real' },
        token: 'tok_not_real',
      })
      .expect(200);

    expect(res.body.dependencies[0].service).toMatchObject({
      baseUrl: 'https://api.stripe.test',
      tokenSet: true,
    });
    expect(JSON.stringify(res.body)).not.toContain('not_real');
    expect(await readGuardOverlays(repoKey)).toEqual({
      dependencies: {},
      externals: {
        stripe: { baseUrl: 'https://api.stripe.test', env: { STRIPE_KEY: 'sk_live_not_real' }, token: 'tok_not_real' },
      },
    });
  });

  it('PUT refuses a host path: there is no machine behind a hosted repository', async () => {
    await bundle({ '.truecourse/scenarios/dependencies.json': { dependencies: [PROJECT_DIR] } });
    const res = await request(app).put(url()).send({ name: 'sample-project', path: '/srv/project' }).expect(422);
    expect(res.body.error).toContain('register it where the scenarios run');
    expect(await readGuardOverlays(repoKey)).toBeNull();
    expect(vi.mocked(emitSpecComplete)).not.toHaveBeenCalled();
  });

  it('PUT refuses a recipe edit: a new variable, a new base-URL variable, an account mode', async () => {
    await bundle({ '.truecourse/scenarios/recipe.json': RECIPE });
    const refused = async (body: Record<string, unknown>) =>
      (await request(app).put(url()).send({ name: 'stripe', baseUrlEnv: 'STRIPE_BASE_URL', ...body }).expect(422)).body
        .error as string;

    expect(await refused({ env: { STRIPE_WEBHOOK_SECRET: 'whsec' } })).toContain('STRIPE_WEBHOOK_SECRET');
    expect(await refused({ baseUrlEnv: 'STRIPE_URL' })).toContain('recipe edit');
    expect(await refused({ mode: 'real' })).toContain('recipe');
    expect(await readGuardOverlays(repoKey)).toBeNull();
  });

  it('the raw route answers the stored catalog entry, never the overlay', async () => {
    await bundle({ '.truecourse/scenarios/dependencies.json': { dependencies: [ACCOUNT] } });
    await writeGuardOverlays(repoKey, {
      dependencies: { anthropic: { env: { ANTHROPIC_API_KEY: 'sk-test-not-real' } } },
      externals: {},
    });
    const res = await request(app).get(rawUrl('anthropic')).expect(200);
    expect(res.body).toMatchObject({ id: 'anthropic', file: '.truecourse/scenarios/dependencies.json' });
    expect(JSON.parse(res.body.content)).toEqual(ACCOUNT);
    expect(res.body.content).not.toContain('sk-test-not-real');
    await request(app).get(rawUrl('ghost')).expect(404);
  });
});
