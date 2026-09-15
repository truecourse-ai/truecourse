/**
 * The enterprise bundle registered into the open server's edition seam: its
 * real feature list mounts the workspaces routes, which the open edition
 * answers 404 (see `tests/dashboard-server/server-features.test.ts`).
 */

import express from 'express';
import request from 'supertest';
import { describe, it, expect, afterEach } from 'vitest';
import {
  clearServerFeatures,
  registerServerFeature,
  registeredServerFeatures,
  type ServerFeatureContext,
} from '../../apps/dashboard/server/src/features';
import { eeServerFeatures } from '../../ee/packages/server/src/features';
import { clearTestRegistry, installTestRegistry } from '../helpers/test-fixture';

afterEach(() => {
  clearServerFeatures();
  clearTestRegistry();
});

describe('the enterprise bundle', () => {
  it('lights up the workspaces routes', async () => {
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
