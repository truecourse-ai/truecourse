/**
 * The enterprise workspaces router (`/api/auth/workspaces`): what the side
 * menu's switcher lists, and the two moves between organizations. All three
 * mint the session cookie, so they work off the sealed session rather than the
 * gate's verifier — which is why they mount above the gate and are built from
 * the open server's workspace session tools.
 *
 * WorkOS is faked, so the tests assert orchestration without a live SDK.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { createWorkspaceSessionTools } from '../../apps/dashboard/server/src/auth/workos-auth';
import { createWorkspacesRouter } from '../../ee/packages/server/src/workspaces/index';

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
  opts: { existingOrg?: string | null; memberships?: Membership[] } = {},
) {
  const calls: Calls = {
    createOrg: [],
    membership: [],
    refresh: [],
    getOrg: [],
    listMemberships: [],
  };
  const memberships = opts.memberships ?? [];
  const user = { id: 'user_1', email: 'u@acme.test' };
  const workos = {
    userManagement: {
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

function makeApp(workos: unknown): Express {
  const app = express();
  app.use(express.json());
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const tools = createWorkspaceSessionTools(workos as any, cfg as any);
  /* eslint-enable @typescript-eslint/no-explicit-any */
  app.use('/api/auth/workspaces', createWorkspacesRouter(tools));
  return app;
}

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
