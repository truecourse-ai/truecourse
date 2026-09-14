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
  listMemberships: Array<Record<string, unknown>>;
}

/** One membership the signed-in user already has, as WorkOS answers it. */
type Membership = {
  id: string;
  organizationId: string;
  organizationName: string;
  status: 'active' | 'inactive' | 'pending';
  userId: string;
};

function makeWorkos(
  opts: {
    existingOrg?: string | null;
    sealedSession?: string | null;
    /** What the user already belongs to, which an org-less session is moved into. */
    memberships?: Membership[];
  } = {},
) {
  const calls: Calls = {
    createOrg: [],
    membership: [],
    refresh: [],
    authorizationUrl: [],
    getOrg: [],
    listMemberships: [],
  };
  const memberships = opts.memberships ?? [];
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
      listOrganizationMemberships: async (o: Record<string, unknown>) => {
        calls.listMemberships.push(o);
        return { data: memberships, autoPagination: async () => memberships };
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

  it('moves a user who already has a membership into it instead of creating a second one', async () => {
    const m = makeWorkos({
      memberships: [
        {
          id: 'om_invited',
          organizationId: 'org_invited',
          organizationName: 'Northwind Labs',
          status: 'active',
          userId: 'user_1',
        },
      ],
    });
    const res = await request(makeApp(m.workos))
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: 'Acme' })
      .expect(200);

    expect(m.calls.createOrg).toEqual([]);
    expect(m.calls.membership).toEqual([]);
    expect(m.calls.listMemberships).toEqual([{ userId: 'user_1' }]);
    expect(m.calls.refresh).toEqual([{ organizationId: 'org_invited' }]);
    expect(res.body.user.organizationId).toBe('org_invited');
    expect(res.body.user.organizationName).toBe('Northwind Labs');
    expect(res.headers['set-cookie']?.[0]).toContain('tc_session=sealed%3Aorg_invited');
  });

  it('creates a workspace for a user whose only membership is inactive', async () => {
    const m = makeWorkos({
      memberships: [
        {
          id: 'om_dead',
          organizationId: 'org_dead',
          organizationName: 'Gone',
          status: 'inactive',
          userId: 'user_1',
        },
      ],
    });
    const res = await request(makeApp(m.workos))
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: 'Acme' })
      .expect(200);

    expect(m.calls.createOrg).toEqual([{ name: 'Acme' }]);
    expect(res.body.user.organizationId).toBe('org_new');
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

  it('moves an org-less session into the workspace its user already belongs to', async () => {
    const m = makeWorkos({
      memberships: [
        {
          id: 'om_invited',
          organizationId: 'org_accepted',
          organizationName: 'Northwind Labs',
          status: 'active',
          userId: 'user_1',
        },
      ],
    });
    verify.mockResolvedValue({ user: { id: 'user_1', email: 'u@acme.test' } });

    const res = await request(makeApp(m.workos))
      .get('/api/auth/me')
      .set('Cookie', 'tc_session=sealed-no-org')
      .expect(200);

    expect(m.calls.listMemberships).toEqual([{ userId: 'user_1' }]);
    expect(m.calls.refresh).toEqual([{ organizationId: 'org_accepted' }]);
    expect(res.body.user.organizationId).toBe('org_accepted');
    // The membership names its organization, so nothing is looked up for it.
    expect(res.body.user.organizationName).toBe('Northwind Labs');
    expect(m.calls.getOrg).toEqual([]);
    // The re-minted session is written back as the session cookie.
    expect(res.headers['set-cookie']?.[0]).toContain('tc_session=sealed%3Aorg_accepted');
  });

  it('asks WorkOS nothing about memberships when the session already has an organization', async () => {
    const m = makeWorkos({
      memberships: [
        {
          id: 'om_other',
          organizationId: 'org_other',
          organizationName: 'Other',
          status: 'active',
          userId: 'user_1',
        },
      ],
    });
    verify.mockResolvedValue({
      user: { id: 'user_1', email: 'u@acme.test', organizationId: 'org_me_3' },
    });

    const res = await request(makeApp(m.workos))
      .get('/api/auth/me')
      .set('Cookie', 'tc_session=sealed')
      .expect(200);

    expect(m.calls.listMemberships).toEqual([]);
    expect(m.calls.refresh).toEqual([]);
    expect(res.body.user.organizationId).toBe('org_me_3');
  });

  it('answers the session as it stands when the move into the workspace fails', async () => {
    const m = makeWorkos({
      memberships: [
        {
          id: 'om_invited',
          organizationId: 'org_unreachable',
          organizationName: 'Northwind Labs',
          status: 'active',
          userId: 'user_1',
        },
      ],
    });
    m.workos.userManagement.loadSealedSession = () => ({
      authenticate: async () => ({ authenticated: true, user: { id: 'user_1', email: 'u@acme.test' }, organizationId: null }),
      refresh: async () => {
        throw new Error('workos down');
      },
    });
    verify.mockResolvedValue({ user: { id: 'user_1', email: 'u@acme.test' } });

    const res = await request(makeApp(m.workos))
      .get('/api/auth/me')
      .set('Cookie', 'tc_session=sealed-no-org')
      .expect(200);

    expect(res.body.user.id).toBe('user_1');
    expect(res.body.user.organizationId).toBeFalsy();
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

/**
 * The workspaces of the signed-in user: what the side menu's switcher lists,
 * and the two moves between organizations. All three mint the session cookie,
 * so they work off the sealed session rather than the gate's verifier.
 */
const WS_A: Membership = {
  id: 'om_a',
  organizationId: 'org_ws_a',
  organizationName: 'Acme',
  status: 'active',
  userId: 'user_1',
};

const WS_B: Membership = {
  id: 'om_b',
  organizationId: 'org_ws_b',
  organizationName: 'Northwind Labs',
  status: 'active',
  userId: 'user_1',
};

describe('GET /api/auth/workspaces', () => {
  it('lists the active memberships, marking the one the session is in', async () => {
    const m = makeWorkos({
      existingOrg: 'org_ws_a',
      memberships: [
        WS_A,
        WS_B,
        { ...WS_B, id: 'om_dead', organizationId: 'org_ws_dead', status: 'inactive' },
      ],
    });
    const res = await request(makeApp(m.workos))
      .get('/api/auth/workspaces')
      .set('Cookie', 'tc_session=sealed')
      .expect(200);

    expect(res.body.workspaces).toEqual([
      { id: 'org_ws_a', name: 'Org org_ws_a', current: true },
      { id: 'org_ws_b', name: 'Org org_ws_b', current: false },
    ]);
    expect(m.calls.listMemberships).toEqual([{ userId: 'user_1' }]);
  });

  it('names each workspace through the cache `/me` fills, looking one up once', async () => {
    // Organizations no other case has named, so this one starts cold.
    const held = [
      { ...WS_A, organizationId: 'org_ws_cold_1' },
      { ...WS_B, organizationId: 'org_ws_cold_2' },
    ];
    const first = makeWorkos({ existingOrg: 'org_ws_cold_1', memberships: held });
    await request(makeApp(first.workos))
      .get('/api/auth/workspaces')
      .set('Cookie', 'tc_session=sealed')
      .expect(200);
    expect(first.calls.getOrg).toEqual(['org_ws_cold_1', 'org_ws_cold_2']);

    // A second read of the same workspaces asks WorkOS for no name again.
    const second = makeWorkos({ existingOrg: 'org_ws_cold_1', memberships: held });
    const res = await request(makeApp(second.workos))
      .get('/api/auth/workspaces')
      .set('Cookie', 'tc_session=sealed')
      .expect(200);
    expect(second.calls.getOrg).toEqual([]);
    expect(res.body.workspaces.map((w: { name: string }) => w.name)).toEqual([
      'Org org_ws_cold_1',
      'Org org_ws_cold_2',
    ]);
  });

  it('falls back to the name the membership carries when the lookup fails', async () => {
    const m = makeWorkos({
      existingOrg: 'org_ws_unnamed',
      memberships: [{ ...WS_A, organizationId: 'org_ws_unnamed', organizationName: 'Acme' }],
    });
    m.workos.organizations.getOrganization = async () => {
      throw new Error('workos down');
    };
    const res = await request(makeApp(m.workos))
      .get('/api/auth/workspaces')
      .set('Cookie', 'tc_session=sealed')
      .expect(200);
    expect(res.body.workspaces).toEqual([{ id: 'org_ws_unnamed', name: 'Acme', current: true }]);
  });

  it('returns 401 without a session cookie', async () => {
    const m = makeWorkos();
    await request(makeApp(m.workos)).get('/api/auth/workspaces').expect(401);
    expect(m.calls.listMemberships).toEqual([]);
  });
});

describe('POST /api/auth/workspaces', () => {
  it('always creates, even for a user already in one, and mints the session into it', async () => {
    const m = makeWorkos({ existingOrg: 'org_ws_a', memberships: [WS_A] });
    const res = await request(makeApp(m.workos))
      .post('/api/auth/workspaces')
      .set('Cookie', 'tc_session=sealed')
      .send({ name: '  Second  ' })
      .expect(200);

    expect(m.calls.createOrg).toEqual([{ name: 'Second' }]); // trimmed
    expect(m.calls.membership).toEqual([{ organizationId: 'org_new', userId: 'user_1' }]);
    expect(m.calls.refresh).toEqual([{ organizationId: 'org_new' }]);
    expect(res.body.user.organizationId).toBe('org_new');
    expect(res.body.user.organizationName).toBe('Second');
    expect(res.headers['set-cookie']?.[0]).toContain('tc_session=sealed%3Aorg_new');
  });

  it('rejects a name that is blank or too long, without asking WorkOS', async () => {
    const m = makeWorkos({ existingOrg: 'org_ws_a' });
    const app = makeApp(m.workos);
    for (const name of ['', '   ', 'x'.repeat(81), 42]) {
      const res = await request(app)
        .post('/api/auth/workspaces')
        .set('Cookie', 'tc_session=sealed')
        .send({ name })
        .expect(400);
      expect(res.body.error).toBe('A workspace name of 1 to 80 characters is required.');
    }
    expect(m.calls.createOrg).toEqual([]);
  });

  it('returns 401 without a session cookie', async () => {
    const m = makeWorkos();
    await request(makeApp(m.workos)).post('/api/auth/workspaces').send({ name: 'Acme' }).expect(401);
    expect(m.calls.createOrg).toEqual([]);
  });
});

describe('POST /api/auth/workspaces/switch', () => {
  it('mints the session into another workspace the user is in', async () => {
    const m = makeWorkos({ existingOrg: 'org_ws_a', memberships: [WS_A, WS_B] });
    const res = await request(makeApp(m.workos))
      .post('/api/auth/workspaces/switch')
      .set('Cookie', 'tc_session=sealed')
      .send({ organizationId: 'org_ws_b' })
      .expect(200);

    expect(m.calls.refresh).toEqual([{ organizationId: 'org_ws_b' }]);
    expect(res.body.user.organizationId).toBe('org_ws_b');
    expect(res.body.user.organizationName).toBe('Northwind Labs');
    expect(res.headers['set-cookie']?.[0]).toContain('tc_session=sealed%3Aorg_ws_b');
    expect(m.calls.createOrg).toEqual([]);
  });

  it('does not know an organization the user has no active membership of', async () => {
    const m = makeWorkos({
      existingOrg: 'org_ws_a',
      memberships: [WS_A, { ...WS_B, organizationId: 'org_ws_left', status: 'inactive' }],
    });
    const app = makeApp(m.workos);
    for (const organizationId of ['org_ws_elsewhere', 'org_ws_left']) {
      const res = await request(app)
        .post('/api/auth/workspaces/switch')
        .set('Cookie', 'tc_session=sealed')
        .send({ organizationId })
        .expect(404);
      expect(res.body.error).toBe('No such workspace.');
    }
    expect(m.calls.refresh).toEqual([]);
  });

  it('rejects a request that names no workspace', async () => {
    const m = makeWorkos({ existingOrg: 'org_ws_a', memberships: [WS_A] });
    await request(makeApp(m.workos))
      .post('/api/auth/workspaces/switch')
      .set('Cookie', 'tc_session=sealed')
      .send({})
      .expect(400);
    expect(m.calls.listMemberships).toEqual([]);
  });

  it('returns 401 without a session cookie', async () => {
    const m = makeWorkos({ memberships: [WS_A] });
    await request(makeApp(m.workos))
      .post('/api/auth/workspaces/switch')
      .send({ organizationId: 'org_ws_a' })
      .expect(401);
    expect(m.calls.refresh).toEqual([]);
  });
});
