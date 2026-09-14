/**
 * The edition seam on the server.
 *
 * The open edition is the one nobody registered into: its registry is empty and
 * the app it builds has only the product's own routes. An edition bundle
 * registers features, and boot mounts what they return — a public one above the
 * auth gate, everything else behind it.
 *
 * Both editions are exercised here, with the enterprise bundle's real feature
 * list, because a registry nothing registers into proves nothing.
 */

import express, { Router } from 'express';
import request from 'supertest';
import { describe, it, expect, afterEach } from 'vitest';
import { createApp } from '../../apps/dashboard/server/src/app';
import {
  clearServerFeatures,
  registerServerFeature,
  registeredServerFeatures,
  type ServerFeatureContext,
} from '../../apps/dashboard/server/src/features';
import { eeServerFeatures } from '../../ee/packages/server/src/features';
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

  it('lights up the enterprise workspaces routes, which the open edition answers 404', async () => {
    installTestRegistry();
    for (const feature of eeServerFeatures) registerServerFeature(feature);
    // The session tools stand in for a request carrying no session, which is all
    // these routes need to answer.
    const workspaceSession = {
      requireSession: async (_req: unknown, res: { status(c: number): { json(b: unknown): void } }) => {
        res.status(401).json({ error: 'Not authenticated' });
        return null;
      },
    } as unknown as ServerFeatureContext['workspaceSession'];
    const routers = registeredServerFeatures().flatMap((f) =>
      f.mount({ workspaceSession } as ServerFeatureContext),
    );
    expect(routers.map((r) => r.path)).toEqual(['/api/auth/workspaces']);

    const app = express();
    app.use(express.json());
    for (const mount of routers) app.use(mount.path, mount.router);
    // The router's own refusal is what answers, which is proof the route is
    // mounted rather than missing.
    await request(app).get('/api/auth/workspaces').expect(401);
  });
});
