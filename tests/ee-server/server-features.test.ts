/**
 * The enterprise bundle registered into the open server's edition seam: its
 * real feature list mounts the workspaces and the connections routes, which the
 * open edition answers 404 (see `tests/dashboard-server/server-features.test.ts`),
 * and contributes the two context source drivers the open edition does not
 * carry.
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

/** What this bundle's features are built from, with nothing real behind it. */
function featureContext(): ServerFeatureContext {
  return {
    // No route reached in this file touches the database.
    db: {} as ServerFeatureContext['db'],
    masterSecret: 'a-master-secret-of-at-least-32-characters',
    // The session tools stand in for a request carrying no session, which is
    // all the workspaces routes need to answer.
    workspaceSession: {
      requireSession: async (_req: unknown, res: { status(c: number): { json(b: unknown): void } }) => {
        res.status(401).json({ error: 'Not authenticated' });
        return null;
      },
    } as unknown as ServerFeatureContext['workspaceSession'],
    capture: () => {},
    contextChanged: async () => {},
  };
}

describe('the enterprise bundle', () => {
  it('lights up the workspaces and the connections routes', async () => {
    installTestRegistry();
    for (const feature of eeServerFeatures) registerServerFeature(feature);
    const routers = registeredServerFeatures().flatMap((f) => f.mount(featureContext()));
    expect(routers.map((r) => r.path)).toEqual(['/api/auth/workspaces', '/api/connections']);

    const app = express();
    app.use(express.json());
    for (const mount of routers) app.use(mount.path, mount.router);
    // The router's own refusal is what answers, which is proof the route is
    // mounted rather than missing.
    await request(app).get('/api/auth/workspaces').expect(401);
    // Connections is behind the gate, so a request with no workspace on it is
    // the refusal its own route writes.
    await request(app).get('/api/connections').expect(403);
  });

  it('contributes the two context source drivers the open edition has not, off one account', () => {
    installTestRegistry();
    for (const feature of eeServerFeatures) registerServerFeature(feature);
    const context = featureContext();
    const drivers = registeredServerFeatures().flatMap(
      (f) => f.contextDrivers?.(context) ?? [],
    );
    expect(drivers.map((d) => d.kind)).toEqual(['jira', 'confluence']);
    // Built per workspace: the account a source reads through is that
    // workspace's ONE Atlassian connection, so the driver cannot be made
    // before the org is known.
    expect(drivers.map((d) => d.driver('org_test').kind)).toEqual(['jira', 'confluence']);
  });
});
