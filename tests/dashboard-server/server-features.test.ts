/**
 * The edition seam on the server.
 *
 * The open edition is the one nobody registered into: its registry is empty and
 * the app it builds has only the product's own routes. An edition bundle
 * registers features, and boot mounts what they return — a public one above the
 * auth gate, everything else behind it.
 *
 * The enterprise bundle's own registration is exercised in
 * `tests/ee-server/server-features.test.ts`; here the seam is proved with a
 * feature of this test's making.
 */

import { Router } from 'express';
import request from 'supertest';
import { describe, it, expect, afterEach } from 'vitest';
import { createApp } from '../../apps/dashboard/server/src/app';
import {
  clearServerFeatures,
  registerServerFeature,
  registeredServerFeatures,
  type ServerFeatureContext,
} from '../../apps/dashboard/server/src/features';
import { clearTestRegistry, installTestRegistry } from '../helpers/test-fixture';

/** A context whose pieces this test's features never touch. */
const CONTEXT = {} as ServerFeatureContext;

/** Two routers, one public and one behind the gate, that say which they are. */
function sayingFeature() {
  const publicRouter: Router = Router();
  publicRouter.get('/', (_req, res) => res.json({ where: 'public' }));
  const gatedRouter: Router = Router();
  gatedRouter.get('/', (_req, res) => res.json({ where: 'gated' }));
  return {
    name: 'the saying feature',
    mount: () => [
      { path: '/api/auth/said', router: publicRouter, public: true },
      { path: '/api/said', router: gatedRouter },
    ],
  };
}

afterEach(() => {
  clearServerFeatures();
  clearTestRegistry();
});

describe('the open edition', () => {
  it('has registered no features, and its app has none of their routes', async () => {
    installTestRegistry();
    expect(registeredServerFeatures()).toEqual([]);

    const app = createApp({ serveStatic: false, authVerifier: null, github: null, jobs: null });
    await request(app).get('/api/auth/workspaces').expect(404);
  });

  it('refuses a route nobody mounted as JSON, whatever the method', async () => {
    installTestRegistry();
    const app = createApp({ serveStatic: false, authVerifier: null, github: null, jobs: null });
    const got = await request(app).get('/api/auth/workspaces').expect(404);
    expect(got.body).toEqual({ error: 'The server has no such route.' });
    const posted = await request(app).post('/api/auth/workspaces').send({ name: 'x' }).expect(404);
    expect(posted.body).toEqual({ error: 'The server has no such route.' });
  });
});

describe('an edition that registers features', () => {
  it('mounts a public router above the gate and the rest behind it', async () => {
    installTestRegistry();
    registerServerFeature(sayingFeature());
    const routers = registeredServerFeatures().flatMap((f) => f.mount(CONTEXT));

    // A verifier that refuses everything, so "behind the gate" is visible.
    const app = createApp({
      serveStatic: false,
      authVerifier: async () => null,
      github: null,
      jobs: null,
      featureRouters: routers,
    });

    const open = await request(app).get('/api/auth/said').expect(200);
    expect(open.body).toEqual({ where: 'public' });
    await request(app).get('/api/said').expect(401);
  });
});
