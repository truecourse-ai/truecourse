import express, { type Express } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createAuthRouter } from '../../apps/dashboard/server/src/auth/workos-auth';
import { captureWorkspaceCreated } from '../../apps/dashboard/server/src/observability/posthog';
import {
  TEST_WORKSPACE_DESCRIPTION,
  installWorkspaceProfiles,
  type MemoryWorkspaceProfiles,
} from '../helpers/workspace-profile';

// The signup event leaves through the analytics module; here it is a spy, so
// the route's one call is asserted and nothing is sent.
vi.mock('../../apps/dashboard/server/src/observability/posthog', () => ({
  captureWorkspaceCreated: vi.fn(),
}));

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
  let profiles: MemoryWorkspaceProfiles;

  beforeEach(() => {
    vi.mocked(captureWorkspaceCreated).mockClear();
    const m = makeWorkos();
    calls = m.calls;
    app = makeApp(m.workos);
    // A workspace is named AND described when it is created: the description is
    // what its documents are attributed against, and nothing connects without one.
    profiles = installWorkspaceProfiles([]);
  });

  it('creates the org + membership, re-mints the session into it, and sets the cookie', async () => {
    const res = await request(app)
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: '  Acme Inc.  ', description: TEST_WORKSPACE_DESCRIPTION })
      .expect(200);

    expect(calls.createOrg).toEqual([{ name: 'Acme Inc.' }]); // trimmed
    // The sentence is stored with the workspace, where the scan reads it.
    expect(profiles.all()).toEqual([
      expect.objectContaining({
        workspaceOrgId: 'org_new',
        description: TEST_WORKSPACE_DESCRIPTION,
      }),
    ]);
    expect(calls.membership).toEqual([{ organizationId: 'org_new', userId: 'user_1' }]);
    expect(calls.refresh).toEqual([{ organizationId: 'org_new' }]); // org-scoped refresh
    expect(res.body.user.organizationId).toBe('org_new');
    // The name the user just typed comes straight back — no second lookup.
    expect(res.body.user.organizationName).toBe('Acme Inc.');
    expect(calls.getOrg).toEqual([]);
    // The re-minted session is written back as the session cookie.
    expect(res.headers['set-cookie']?.[0]).toContain('tc_session=sealed%3Aorg_new');
    // The signup is reported once, as the person, for the workspace just named.
    expect(captureWorkspaceCreated).toHaveBeenCalledTimes(1);
    expect(captureWorkspaceCreated).toHaveBeenCalledWith({
      userId: 'user_1',
      email: 'u@acme.test',
      name: undefined,
      workspaceId: 'org_new',
      workspaceName: 'Acme Inc.',
    });
  });

  it('is idempotent: a user already in an org gets it back without creating a new one', async () => {
    // The token's claim is confirmed against the membership behind it.
    const m = makeWorkos({
      existingOrg: 'org_existing',
      memberships: [
        { id: 'om_existing', organizationId: 'org_existing', organizationName: 'Existing', status: 'active', userId: 'user_1' },
      ],
    });
    const res = await request(makeApp(m.workos))
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-has-org')
      .send({ name: 'Another', description: TEST_WORKSPACE_DESCRIPTION })
      .expect(200);

    expect(m.calls.createOrg).toEqual([]); // no second org
    expect(m.calls.membership).toEqual([]);
    expect(res.body.user.organizationId).toBe('org_existing');
    expect(captureWorkspaceCreated).not.toHaveBeenCalled();
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
      .send({ name: 'Acme', description: TEST_WORKSPACE_DESCRIPTION })
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
      .send({ name: 'Acme', description: TEST_WORKSPACE_DESCRIPTION })
      .expect(200);

    expect(m.calls.createOrg).toEqual([{ name: 'Acme' }]);
    expect(res.body.user.organizationId).toBe('org_new');
  });

  it('rejects a missing/blank name with 400 (no WorkOS calls)', async () => {
    await request(app)
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: '   ', description: TEST_WORKSPACE_DESCRIPTION })
      .expect(400);
    expect(calls.createOrg).toEqual([]);
  });

  it('rejects an over-long name with 400', async () => {
    await request(app)
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: 'x'.repeat(81), description: TEST_WORKSPACE_DESCRIPTION })
      .expect(400);
  });

  it('rejects a workspace that says nothing about its product, with no WorkOS calls', async () => {
    await request(app)
      .post('/api/auth/workspace')
      .set('Cookie', 'tc_session=sealed-no-org')
      .send({ name: 'Acme Inc.' })
      .expect(400);
    expect(calls.createOrg).toEqual([]);
    expect(profiles.all()).toEqual([]);
  });

  it('returns 401 when there is no session cookie', async () => {
    await request(app)
      .post('/api/auth/workspace')
      .send({ name: 'Acme', description: TEST_WORKSPACE_DESCRIPTION })
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
    await request(makeApp(m.workos)).get('/api/auth/login?next=/code').expect(302);
    expect(m.calls.authorizationUrl[0]?.state).toBe('/code');
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
      .get('/api/auth/callback?code=abc&state=%2Fcode')
      .expect(302);
    expect(res.headers.location).toBe('http://localhost:3000/code');
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
