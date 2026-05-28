/**
 * Workspace data endpoints: scoped to the signed-in user's WorkOS org
 * (read from req.eeUser, which the OSS gate sets), with WorkOS faked.
 */

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { WorkOS } from '@workos-inc/node';
import {
  createWorkspaceRouter,
  type WorkspaceDataReaders,
} from '../../ee/packages/server/src/workspace';

// Deterministic core readers (injected) so /overview doesn't touch the
// real registry/filesystem. Two repos; one analyzed, one never analyzed.
const fakeReaders = {
  readRegistry: () => [
    { slug: 'a', name: 'acme/api', path: '/x/a', lastAnalyzed: '2099-01-01T00:00:00.000Z' },
    { slug: 'b', name: 'acme/web', path: '/x/b' },
  ],
  listViolations: () => ({
    violations: [{ severity: 'critical' }, { severity: 'high' }],
    total: 2,
  }),
  readVerifyState: () => ({ drifts: [{}, {}] }),
} as unknown as WorkspaceDataReaders;

function fakeWorkos(): WorkOS {
  return {
    sso: {
      listConnections: async ({ organizationId }: { organizationId?: string }) => ({
        data:
          organizationId === 'org_1'
            ? [{ id: 'c1', name: 'Okta', type: 'OktaSAML', state: 'active' }]
            : [],
      }),
    },
    userManagement: {
      listUsers: async ({ organizationId }: { organizationId?: string }) => ({
        data:
          organizationId === 'org_1'
            ? [{ id: 'u1', email: 'a@b.com', firstName: 'Ada', lastName: 'Lovelace' }]
            : [],
      }),
    },
    organizations: {
      getOrganization: async () => ({ name: 'Acme Corp' }),
    },
  } as unknown as WorkOS;
}

function appWith(organizationId?: string) {
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { eeUser?: unknown }).eeUser = organizationId
      ? { id: 'u', email: 'e@x.com', organizationId }
      : undefined;
    next();
  });
  app.use('/api/ee/workspace', createWorkspaceRouter(fakeWorkos(), fakeReaders));
  return app;
}

describe('workspace routes', () => {
  it('reports configured SSO + connections for the org', async () => {
    const res = await request(appWith('org_1')).get('/api/ee/workspace/sso-status');
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.connections).toHaveLength(1);
    expect(res.body.connections[0]).toMatchObject({ name: 'Okta', state: 'active' });
  });

  it('lists members for the org', async () => {
    const res = await request(appWith('org_1')).get('/api/ee/workspace/members');
    expect(res.status).toBe(200);
    expect(res.body.members).toEqual([
      { id: 'u1', email: 'a@b.com', firstName: 'Ada', lastName: 'Lovelace' },
    ]);
  });

  it('aggregates repo + analysis stats and member/org info for /overview', async () => {
    const res = await request(appWith('org_1')).get('/api/ee/workspace/overview');
    expect(res.status).toBe(200);
    expect(res.body.organizationName).toBe('Acme Corp');
    // 2 repos × (2 violations, 2 drifts); repo 'b' never analyzed → stale.
    expect(res.body.stats).toMatchObject({
      repoCount: 2,
      violationCount: 4,
      driftCount: 4,
      staleCount: 1,
      severity: { critical: 2, high: 2, medium: 0, low: 0, info: 0 },
    });
    expect(res.body.repos.map((r: { id: string }) => r.id)).toEqual(['a', 'b']);
  });

  it('returns empty/unconfigured when the session has no organization', async () => {
    const sso = await request(appWith()).get('/api/ee/workspace/sso-status');
    expect(sso.body).toEqual({ configured: false, connections: [] });
    const members = await request(appWith()).get('/api/ee/workspace/members');
    expect(members.body).toEqual({ members: [] });
  });
});
