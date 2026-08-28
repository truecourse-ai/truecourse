import express, { type Express } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAuthRouter } from '../../apps/dashboard/server/src/auth/workos-auth';

/**
 * The public auth router (`/api/auth`): the self-serve workspace-creation
 * endpoint, the organization name `/me` puts on the session, the login →
 * callback `next` round-trip, and the fact that the router uses the ONE
 * verifier it is handed rather than building a second one.
 * WorkOS is faked so the tests assert orchestration without a live SDK.
 */

const cfg = {
  apiKey: 'sk_test',
  clientId: 'client_test',
  redirectUri: 'http://localhost:3001/api/auth/callback',
  cookiePassword: 'x'.repeat(40),
  appUrl: 'http://localhost:3000',
} as const;

interface Calls {
  createOrg: Array<{ name: string }>;
  membership: Array<{ organizationId: string; userId: string }>;
  refresh: Array<{ organizationId?: string }>;
  authorizationUrl: Array<Record<string, unknown>>;
  getOrg: string[];
}

function makeWorkos(opts: { existingOrg?: string | null; sealedSession?: string | null } = {}) {
  const calls: Calls = {
    createOrg: [],
    membership: [],
    refresh: [],
    authorizationUrl: [],
    getOrg: [],
  };
  const user = { id: 'user_1', email: 'u@acme.test' };
  const workos = {
    userManagement: {
      getAuthorizationUrl: (params: Record<string, unknown>) => {
        calls.authorizationUrl.push(params);
        return 'http://workos/login';
      },
      authenticateWithCode: async () => ({
        sealedSession: opts.sealedSession === undefined ? 'sealed:new' : opts.sealedSession,
        user,
      }),
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
      getOrganization: async (id: string) => {
        calls.getOrg.push(id);
        return { id, name: `Org ${id}` };
      },
    },
  };
  return { workos, calls };
}

// The verifier the gate also holds; the router must call THIS one.
const verify = vi.fn(async () => null as unknown);

function makeApp(workos: unknown): Express {
  const app = express();
  app.use(express.json());
  /* eslint-disable @typescript-eslint/no-explicit-any */
  app.use('/api/auth', createAuthRouter(workos as any, cfg as any, verify as any));
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return app;
}

describe('POST /api/auth/workspace', () => {
  let calls: Calls;
  let app: Express;

  beforeEach(() => {
    const m = makeWorkos();
    calls = m.calls;
    app = makeApp(m.workos);
  });

  it('creates the org + membership, re-mints the session into it, and sets the cookie', async () => {
    const res = await request(app)
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: '  Acme Inc.  ' })
      .expect(200);

    expect(calls.createOrg).toEqual([{ name: 'Acme Inc.' }]); // trimmed
    expect(calls.membership).toEqual([{ organizationId: 'org_new', userId: 'user_1' }]);
    expect(calls.refresh).toEqual([{ organizationId: 'org_new' }]); // org-scoped refresh
    expect(res.body.user.organizationId).toBe('org_new');
    // The name the user just typed comes straight back — no second lookup.
    expect(res.body.user.organizationName).toBe('Acme Inc.');
    expect(calls.getOrg).toEqual([]);
    // The re-minted session is written back as the session cookie.
    expect(res.headers['set-cookie']?.[0]).toContain('tc_session=sealed%3Aorg_new');
  });

  it('is idempotent: a user already in an org gets it back without creating a new one', async () => {
    const m = makeWorkos({ existingOrg: 'org_existing' });
    const res = await request(makeApp(m.workos))
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-has-org')
      .send({ name: 'Another' })
      .expect(200);

    expect(m.calls.createOrg).toEqual([]); // no second org
    expect(m.calls.membership).toEqual([]);
    expect(res.body.user.organizationId).toBe('org_existing');
  });

  it('rejects a missing/blank name with 400 (no WorkOS calls)', async () => {
    await request(app)
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: '   ' })
      .expect(400);
    expect(calls.createOrg).toEqual([]);
  });

  it('rejects an over-long name with 400', async () => {
    await request(app)
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: 'x'.repeat(81) })
      .expect(400);
  });

  it('returns 401 when there is no session cookie', async () => {
    await request(app)
      .post('/api/auth/workspace')
      .send({ name: 'Acme' })
      .expect(401);
    expect(calls.createOrg).toEqual([]);
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => verify.mockReset());

  it('resolves the session through the verifier it was constructed with', async () => {
    const m = makeWorkos();
    verify.mockResolvedValue({ user: { id: 'user_1', email: 'u@acme.test' } });

    const res = await request(makeApp(m.workos))
      .get('/api/auth/me')
      .set('Cookie', 'tc_session=sealed')
      .expect(200);

    expect(verify).toHaveBeenCalledWith('tc_session=sealed');
    expect(res.body.user.id).toBe('user_1');
    // No organization on the session → nothing to look up.
    expect(m.calls.getOrg).toEqual([]);
  });

  it('names the organization, looking it up once per process', async () => {
    const m = makeWorkos();
    verify.mockResolvedValue({
      user: { id: 'user_1', email: 'u@acme.test', organizationId: 'org_me_1' },
    });
    const app = makeApp(m.workos);

    const first = await request(app).get('/api/auth/me').expect(200);
    expect(first.body.user.organizationName).toBe('Org org_me_1');

    const second = await request(app).get('/api/auth/me').expect(200);
    expect(second.body.user.organizationName).toBe('Org org_me_1');
    // Cached for the life of the process: one lookup, two requests.
    expect(m.calls.getOrg).toEqual(['org_me_1']);
  });

  it('still answers when the organization lookup fails', async () => {
    const m = makeWorkos();
    m.workos.organizations.getOrganization = async () => {
      throw new Error('workos down');
    };
    verify.mockResolvedValue({
      user: { id: 'user_1', email: 'u@acme.test', organizationId: 'org_me_2' },
    });

    const res = await request(makeApp(m.workos)).get('/api/auth/me').expect(200);
    expect(res.body.user.organizationId).toBe('org_me_2');
    expect(res.body.user.organizationName).toBeUndefined();
  });
});

describe('login → callback `next` round-trip', () => {
  beforeEach(() => verify.mockReset());

  it('carries a relative `next` through the WorkOS `state` param', async () => {
    const m = makeWorkos();
    await request(makeApp(m.workos)).get('/api/auth/login?next=/preview').expect(302);
    expect(m.calls.authorizationUrl[0]?.state).toBe('/preview');
  });

  it('drops an absolute or protocol-relative `next` (open-redirect guard)', async () => {
    for (const bad of ['//evil.test/x', 'https://evil.test', 'preview']) {
      const m = makeWorkos();
      await request(makeApp(m.workos))
        .get(`/api/auth/login?next=${encodeURIComponent(bad)}`)
        .expect(302);
      expect(m.calls.authorizationUrl[0]?.state).toBeUndefined();
    }
  });

  it('redirects the callback to appUrl + state', async () => {
    const m = makeWorkos();
    const res = await request(makeApp(m.workos))
      .get('/api/auth/callback?code=abc&state=%2Fpreview')
      .expect(302);
    expect(res.headers.location).toBe('http://localhost:3000/preview');
  });

  it('falls back to appUrl when state is missing or unsafe', async () => {
    const m = makeWorkos();
    const plain = await request(makeApp(m.workos)).get('/api/auth/callback?code=abc').expect(302);
    expect(plain.headers.location).toBe('http://localhost:3000');

    const unsafe = await request(makeApp(m.workos))
      .get('/api/auth/callback?code=abc&state=%2F%2Fevil.test')
      .expect(302);
    expect(unsafe.headers.location).toBe('http://localhost:3000');
  });
});
