/**
 * The public half of invite by link (`/api/auth`): the preview the invite
 * page shows, the login an invite sends a visitor through, and the accept that redeems a link
 * for the signed-in visitor — once, with the membership created in WorkOS and
 * the session re-minted into the workspace. WorkOS is faked the way
 * `auth-workspace.test.ts` fakes it.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthResult } from '@truecourse/shared';
import {
  createAuthRouter,
  createWorkspaceSessionTools,
} from '../../apps/dashboard/server/src/auth/workos-auth';
import { createInviteLinkRouter } from '../../apps/dashboard/server/src/auth/invite-links';
import { MemoryInviteLinkStore } from '../helpers/memory-invite-links';

const cfg = {
  apiKey: 'sk_test',
  clientId: 'client_test',
  redirectUri: 'http://localhost:3001/api/auth/callback',
  cookiePassword: 'x'.repeat(40),
  appUrl: 'http://localhost:3000',
} as const;

const ORG = 'org_acme';
const USER = { id: 'user_new', email: 'new@example.test' };
const DAY = 24 * 60 * 60 * 1000;

interface Calls {
  membership: Array<{ organizationId: string; userId: string }>;
  refresh: Array<{ organizationId?: string }>;
  authorizationUrl: Array<Record<string, unknown>>;
}

/** WorkOS's refusal of a membership that already exists. */
class ConflictException extends Error {
  readonly status = 409;
}

function makeWorkos(
  opts: { refuseMembership?: string; alreadyMember?: boolean; refuseMint?: boolean } = {},
) {
  const calls: Calls = { membership: [], refresh: [], authorizationUrl: [] };
  const workos = {
    userManagement: {
      getAuthorizationUrl: (params: Record<string, unknown>) => {
        calls.authorizationUrl.push(params);
        return 'http://workos/login';
      },
      loadSealedSession: () => ({
        refresh: async (o: { organizationId?: string }) => {
          calls.refresh.push(o);
          if (opts.refuseMint) throw new Error('WorkOS is unavailable');
          return {
            authenticated: true,
            sealedSession: `sealed:${o.organizationId}`,
            user: USER,
            organizationId: o.organizationId ?? null,
          };
        },
      }),
      createOrganizationMembership: async (o: { organizationId: string; userId: string }) => {
        if (opts.refuseMembership) throw new Error(opts.refuseMembership);
        if (opts.alreadyMember) throw new ConflictException('membership already exists');
        calls.membership.push(o);
        return { id: 'om_new', organizationName: 'Acme' };
      },
    },
    organizations: {
      getOrganization: async (id: string) => ({ id, name: 'Acme' }),
    },
  };
  return { workos, calls };
}

/** What the gate's verifier answers for the `tc_session=sealed` cookie; nothing for any other. */
let session: AuthResult = { user: { id: USER.id, email: USER.email } };
const verify = vi.fn(async (cookie: string | undefined): Promise<AuthResult | null> =>
  cookie?.includes('tc_session=sealed') ? session : null,
);

let links: MemoryInviteLinkStore;

function makeApp(workos: unknown, opts: { manyWorkspaces?: boolean } = {}): Express {
  links = new MemoryInviteLinkStore();
  const app = express();
  app.use(express.json());
  /* eslint-disable @typescript-eslint/no-explicit-any */
  app.use('/api/auth', createAuthRouter(workos as any, cfg as any, verify as any));
  app.use(
    '/api/auth',
    createInviteLinkRouter({
      verify: verify as any,
      tools: createWorkspaceSessionTools(workos as any, cfg as any),
      inviteLinks: links,
      manyWorkspaces: opts.manyWorkspaces ?? false,
    }),
  );
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return app;
}

const accept = (app: Express, token: string) =>
  request(app).post(`/api/auth/invite/${token}/accept`).set('Cookie', 'tc_session=sealed');

beforeEach(() => {
  verify.mockClear();
  session = { user: { id: USER.id, email: USER.email } };
});

describe('GET /api/auth/login from an invite', () => {
  it('carries the invite page as the destination and asks AuthKit for no particular screen', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos);
    await request(app)
      .get('/api/auth/login')
      .query({ next: '/invite/tok_1?accept=1', screen: 'sign-up' })
      .expect(302);
    expect(m.calls.authorizationUrl[0]).toMatchObject({ state: '/invite/tok_1?accept=1' });
    expect(m.calls.authorizationUrl[0]).not.toHaveProperty('screenHint');
  });
});

describe('GET /api/auth/invite/:token', () => {
  it('names the workspace and the sender behind a standing link, and nothing else of the workspace', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos);
    const link = links.seed({ workspaceOrgId: ORG });
    const res = await request(app).get(`/api/auth/invite/${link.token}`).expect(200);
    expect(res.body).toEqual({ workspaceName: 'Acme', inviterName: 'Dana Rees', expiresAt: link.expiresAt });
  });

  it('names nobody when the link was minted without a name', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos);
    const link = links.seed({ workspaceOrgId: ORG, inviterName: null });
    const res = await request(app).get(`/api/auth/invite/${link.token}`).expect(200);
    expect(res.body.inviterName).toBeNull();
  });

  it('refuses a link that does not exist, was used, or expired, saying which', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos);
    const used = links.seed({ workspaceOrgId: ORG, consumedAt: new Date().toISOString() });
    const old = links.seed({ workspaceOrgId: ORG, expiresAt: new Date(Date.now() - DAY).toISOString() });

    const missing = await request(app).get('/api/auth/invite/nope').expect(404);
    expect(missing.body.reason).toBe('invalid');
    const spent = await request(app).get(`/api/auth/invite/${used.token}`).expect(409);
    expect(spent.body.reason).toBe('used');
    const lapsed = await request(app).get(`/api/auth/invite/${old.token}`).expect(410);
    expect(lapsed.body.reason).toBe('expired');
  });
});

describe('POST /api/auth/invite/:token/accept', () => {
  it('puts the signed-in visitor into the workspace and mints the session into it', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos);
    const link = links.seed({ workspaceOrgId: ORG });

    const res = await accept(app, link.token).expect(200);

    expect(m.calls.membership).toEqual([{ organizationId: ORG, userId: USER.id }]);
    expect(m.calls.refresh).toEqual([{ organizationId: ORG }]);
    expect(res.headers['set-cookie']?.[0]).toContain(`tc_session=sealed%3A${ORG}`);
    expect(res.body.user).toMatchObject({ id: USER.id, organizationId: ORG, organizationName: 'Acme' });
    expect(links.rows.get(link.id)).toMatchObject({ consumedByUserId: USER.id });
    expect(links.rows.get(link.id)?.consumedAt).not.toBeNull();
  });

  it('wants a session first', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos);
    const link = links.seed({ workspaceOrgId: ORG });
    await request(app).post(`/api/auth/invite/${link.token}/accept`).expect(401);
    expect(m.calls.membership).toEqual([]);
    expect(links.rows.get(link.id)?.consumedAt).toBeNull();
  });

  it('lets a link in once: the second accept is told it was used', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos);
    const link = links.seed({ workspaceOrgId: ORG });

    await accept(app, link.token).expect(200);
    const again = await accept(app, link.token).expect(409);

    expect(again.body.reason).toBe('used');
    expect(m.calls.membership).toHaveLength(1);
  });

  it('refuses an expired or unknown link without touching WorkOS', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos);
    const old = links.seed({ workspaceOrgId: ORG, expiresAt: new Date(Date.now() - DAY).toISOString() });

    const lapsed = await accept(app, old.token).expect(410);
    expect(lapsed.body.reason).toBe('expired');
    await accept(app, 'nope').expect(404);
    expect(m.calls.membership).toEqual([]);
  });

  it('releases the link when WorkOS refuses the membership, so it can be tried again, and keeps WorkOS’s words to itself', async () => {
    const m = makeWorkos({ refuseMembership: 'organization is full' });
    const app = makeApp(m.workos);
    const link = links.seed({ workspaceOrgId: ORG });

    const res = await accept(app, link.token).expect(502);

    // The visitor is an outsider: what WorkOS said stays in the log.
    expect(res.body.error).toBe('Could not join the workspace. Try again in a moment.');
    expect(JSON.stringify(res.body)).not.toContain('organization is full');
    expect(links.rows.get(link.id)).toMatchObject({ consumedAt: null, consumedByUserId: null });
    expect(m.calls.refresh).toEqual([]);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('moves a visitor who is a member already into the workspace, and leaves the link standing', async () => {
    const m = makeWorkos({ alreadyMember: true });
    const app = makeApp(m.workos);
    const link = links.seed({ workspaceOrgId: ORG });

    const res = await accept(app, link.token).expect(200);

    expect(m.calls.refresh).toEqual([{ organizationId: ORG }]);
    expect(res.headers['set-cookie']?.[0]).toContain(`tc_session=sealed%3A${ORG}`);
    expect(res.body.user).toMatchObject({ id: USER.id, organizationId: ORG });
    // The seat existed before the link did: whoever needs the link still can.
    expect(links.rows.get(link.id)).toMatchObject({ consumedAt: null, consumedByUserId: null });
  });

  it('keeps the link spent once the membership exists, even when the session cannot follow', async () => {
    const m = makeWorkos({ refuseMint: true });
    const app = makeApp(m.workos);
    const link = links.seed({ workspaceOrgId: ORG });

    const res = await accept(app, link.token).expect(502);

    expect(m.calls.membership).toHaveLength(1);
    expect(res.body.error).toContain('Sign out and back in');
    expect(links.rows.get(link.id)).toMatchObject({ consumedByUserId: USER.id });
    // Trying again does not hand the seat's link to a second person.
    const again = await accept(app, link.token).expect(409);
    expect(again.body.reason).toBe('used');
  });

  it('refuses a session already in another workspace, where a person is in one', async () => {
    session = { user: { id: USER.id, email: USER.email, organizationId: 'org_other' } };
    const m = makeWorkos();
    const app = makeApp(m.workos);
    const link = links.seed({ workspaceOrgId: ORG });

    const res = await accept(app, link.token).expect(409);

    expect(res.body.reason).toBe('elsewhere');
    expect(m.calls.membership).toEqual([]);
    expect(links.rows.get(link.id)?.consumedAt).toBeNull();
  });

  it('lets a session in another workspace join where a person may be in many', async () => {
    session = { user: { id: USER.id, email: USER.email, organizationId: 'org_other' } };
    const m = makeWorkos();
    const app = makeApp(m.workos, { manyWorkspaces: true });
    const link = links.seed({ workspaceOrgId: ORG });

    await accept(app, link.token).expect(200);

    expect(m.calls.membership).toEqual([{ organizationId: ORG, userId: USER.id }]);
    expect(m.calls.refresh).toEqual([{ organizationId: ORG }]);
  });

  it('hands back a session the verifier rotated, whatever it answers', async () => {
    session = {
      user: { id: USER.id, email: USER.email },
      setCookie: 'tc_session=rotated; Path=/; HttpOnly',
    };
    const m = makeWorkos();
    const app = makeApp(m.workos);
    const used = links.seed({ workspaceOrgId: ORG, consumedAt: new Date().toISOString() });
    const link = links.seed({ workspaceOrgId: ORG });

    const refused = await accept(app, used.token).expect(409);
    expect(refused.headers['set-cookie']).toEqual(['tc_session=rotated; Path=/; HttpOnly']);

    // On success the minted cookie is the one that lands, chained off the rotated session.
    const joined = await accept(app, link.token).expect(200);
    expect(joined.headers['set-cookie']).toHaveLength(1);
    expect(joined.headers['set-cookie']?.[0]).toContain(`tc_session=sealed%3A${ORG}`);
  });
});

describe('what a visitor may present as a token', () => {
  it('reads an odd token as a link that does not exist, on the preview and the accept alike', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos);
    const odd = ['%2F', 'a%20b', 'x'.repeat(2000), encodeURIComponent('tok/with?query=1&x=2'), '%F0%9F%94%91'];
    for (const token of odd) {
      const preview = await request(app).get(`/api/auth/invite/${token}`);
      expect(preview.status, `preview of ${token}`).toBe(404);
      expect(preview.body.reason).toBe('invalid');
      const accepted = await accept(app, token);
      expect(accepted.status, `accept of ${token}`).toBe(404);
      expect(accepted.body.reason).toBe('invalid');
    }
    expect(m.calls.membership).toEqual([]);
    expect(m.calls.refresh).toEqual([]);
  });

  it('lets a member whose session already sits in the workspace through, spending nothing', async () => {
    session = { user: { id: USER.id, email: USER.email, organizationId: ORG } };
    const m = makeWorkos({ alreadyMember: true });
    const app = makeApp(m.workos);
    const link = links.seed({ workspaceOrgId: ORG });

    // The same workspace is never "elsewhere", whatever the edition.
    const res = await accept(app, link.token).expect(200);

    expect(res.body.user).toMatchObject({ id: USER.id, organizationId: ORG });
    expect(links.rows.get(link.id)).toMatchObject({ consumedAt: null, consumedByUserId: null });
  });

  it('previews a workspace whose name WorkOS will not give as "a workspace"', async () => {
    const m = makeWorkos();
    const workos = {
      ...m.workos,
      organizations: {
        getOrganization: async () => {
          throw new Error('WorkOS is unavailable');
        },
      },
    };
    const app = makeApp(workos);
    // An organization no earlier test named, so the process-wide name cache is cold for it.
    const link = links.seed({ workspaceOrgId: 'org_nameless' });

    const res = await request(app).get(`/api/auth/invite/${link.token}`).expect(200);

    expect(res.body.workspaceName).toBe('a workspace');
    expect(JSON.stringify(res.body)).not.toContain('unavailable');
  });
});
