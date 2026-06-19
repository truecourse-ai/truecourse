import express, { type Express } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach } from 'vitest';
import { createAuthRouter } from '../../ee/packages/server/src/auth';

/**
 * The self-serve workspace-creation endpoint (`POST /api/ee/auth/workspace`):
 * a signed-in user with no org names a workspace → we create the WorkOS org,
 * add them as a member, and re-mint the session INTO it. WorkOS is faked so the
 * test asserts the orchestration (create → membership → org-scoped refresh →
 * Set-Cookie) without a live SDK.
 */

const cfg = {
  apiKey: 'sk_test',
  clientId: 'client_test',
  redirectUri: 'http://localhost:3001/api/ee/auth/callback',
  cookiePassword: 'x'.repeat(40),
  appUrl: 'http://localhost:3000',
} as const;

interface Calls {
  createOrg: Array<{ name: string }>;
  membership: Array<{ organizationId: string; userId: string }>;
  refresh: Array<{ organizationId?: string }>;
}

function makeWorkos(opts: { existingOrg?: string | null } = {}) {
  const calls: Calls = { createOrg: [], membership: [], refresh: [] };
  const user = { id: 'user_1', email: 'u@acme.test' };
  const workos = {
    userManagement: {
      // construction-time only
      getAuthorizationUrl: () => 'http://workos/login',
      loadSealedSession: () => ({
        authenticate: async () => ({
          authenticated: true,
          user,
          organizationId: opts.existingOrg ?? null,
        }),
        refresh: async (o: { organizationId?: string }) => {
          calls.refresh.push(o);
          return {
            authenticated: true,
            sealedSession: `sealed:${o.organizationId}`,
            user,
            organizationId: o.organizationId ?? null,
          };
        },
      }),
      createOrganizationMembership: async (o: { organizationId: string; userId: string }) => {
        calls.membership.push(o);
        return { id: 'om_1' };
      },
    },
    organizations: {
      createOrganization: async (o: { name: string }) => {
        calls.createOrg.push(o);
        return { id: 'org_new', name: o.name };
      },
    },
  };
  return { workos, calls };
}

function makeApp(workos: unknown): Express {
  const app = express();
  app.use(express.json());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use('/api/ee/auth', createAuthRouter(workos as any, cfg as any));
  return app;
}

describe('POST /api/ee/auth/workspace', () => {
  let calls: Calls;
  let app: Express;

  beforeEach(() => {
    const m = makeWorkos();
    calls = m.calls;
    app = makeApp(m.workos);
  });

  it('creates the org + membership, re-mints the session into it, and sets the cookie', async () => {
    const res = await request(app)
      .post('/api/ee/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: '  Acme Inc.  ' })
      .expect(200);

    expect(calls.createOrg).toEqual([{ name: 'Acme Inc.' }]); // trimmed
    expect(calls.membership).toEqual([{ organizationId: 'org_new', userId: 'user_1' }]);
    expect(calls.refresh).toEqual([{ organizationId: 'org_new' }]); // org-scoped refresh
    expect(res.body.user.organizationId).toBe('org_new');
    // The re-minted session is written back as the session cookie.
    expect(res.headers['set-cookie']?.[0]).toContain('tc_session=sealed%3Aorg_new');
  });

  it('is idempotent: a user already in an org gets it back without creating a new one', async () => {
    const m = makeWorkos({ existingOrg: 'org_existing' });
    const res = await request(makeApp(m.workos))
      .post('/api/ee/auth/workspace')
      .set('Cookie', 'tc_session=sealed-has-org')
      .send({ name: 'Another' })
      .expect(200);

    expect(m.calls.createOrg).toEqual([]); // no second org
    expect(m.calls.membership).toEqual([]);
    expect(res.body.user.organizationId).toBe('org_existing');
  });

  it('rejects a missing/blank name with 400 (no WorkOS calls)', async () => {
    await request(app)
      .post('/api/ee/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: '   ' })
      .expect(400);
    expect(calls.createOrg).toEqual([]);
  });

  it('rejects an over-long name with 400', async () => {
    await request(app)
      .post('/api/ee/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: 'x'.repeat(81) })
      .expect(400);
  });

  it('returns 401 when there is no session cookie', async () => {
    await request(app)
      .post('/api/ee/auth/workspace')
      .send({ name: 'Acme' })
      .expect(401);
    expect(calls.createOrg).toEqual([]);
  });
});
