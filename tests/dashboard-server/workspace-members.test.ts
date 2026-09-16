/**
 * Settings › Members on the server: `/api/workspace`.
 *
 * The workspace's people are its WorkOS organization's active memberships and
 * the invitations standing against it, composed on every read rather than kept
 * anywhere, so these tests drive a FAKE WorkOS (the shape
 * `auth-workspace.test.ts` uses) and assert the orchestration: what is
 * composed, what is refused, and what is asked of WorkOS.
 *
 * The two refusals that matter are the ones nobody can undo: you can never
 * remove yourself, and the last member can never be removed.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthUser } from '@truecourse/shared';
import { createWorkspaceMembersRouter } from '../../apps/dashboard/server/src/auth/workspace-members';
import { MemoryInviteLinkStore } from '../helpers/memory-invite-links';
import {
  captureAction,
  EVENTS,
} from '../../apps/dashboard/server/src/observability/posthog';

// Minting a link is reported from the route that mints it; the analytics
// module's one capture is a spy, so the call is asserted and nothing is sent.
vi.mock('../../apps/dashboard/server/src/observability/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../apps/dashboard/server/src/observability/posthog')>()),
  captureAction: vi.fn(),
}));

const ORG = 'org_acme';
const DAY = 24 * 60 * 60 * 1000;
const soon = new Date(Date.now() + 3 * DAY).toISOString();
const past = new Date(Date.now() - 3 * DAY).toISOString();

type Membership = {
  id: string;
  organizationId: string;
  organizationName: string;
  status: 'active' | 'inactive' | 'pending';
  userId: string;
  createdAt: string;
};

type FakeUser = { id: string; email: string; firstName?: string | null; lastName?: string | null };

type FakeInvitation = {
  id: string;
  email: string;
  state: 'pending' | 'accepted' | 'expired' | 'revoked';
  expiresAt: string;
  createdAt: string;
  organizationId: string;
  acceptInvitationUrl: string;
};

interface Calls {
  sent: Array<Record<string, unknown>>;
  revoked: string[];
  deleted: string[];
  memberships: Array<Record<string, unknown>>;
}

/** The SDK's list answer: a page with the whole set behind `autoPagination`. */
function page<T>(items: T[]) {
  return { data: items, autoPagination: async () => items };
}

function membership(over: Partial<Membership> & { id: string; userId: string }): Membership {
  return {
    organizationId: ORG,
    organizationName: 'Acme',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function invitation(over: Partial<FakeInvitation> & { id: string; email: string }): FakeInvitation {
  return {
    state: 'pending',
    expiresAt: soon,
    createdAt: '2026-02-01T00:00:00.000Z',
    organizationId: ORG,
    acceptInvitationUrl: `https://workos.test/invite/${over.id}`,
    ...over,
  };
}

const ME: FakeUser = { id: 'user_me', email: 'dana@acme.test', firstName: 'Dana', lastName: 'Rees' };
const THEM: FakeUser = { id: 'user_them', email: 'sam@acme.test' };

function makeWorkos(
  world: {
    memberships?: Membership[];
    users?: FakeUser[];
    invitations?: FakeInvitation[];
    fail?: string;
  } = {},
) {
  const memberships = world.memberships ?? [
    membership({ id: 'om_me', userId: ME.id, createdAt: '2026-01-01T00:00:00.000Z' }),
    membership({ id: 'om_them', userId: THEM.id, createdAt: '2026-03-01T00:00:00.000Z' }),
  ];
  const users = world.users ?? [ME, THEM];
  const invitations = world.invitations ?? [];
  const calls: Calls = { sent: [], revoked: [], deleted: [], memberships: [] };

  const refuse = () => {
    if (world.fail) throw new Error(world.fail);
  };

  const workos = {
    userManagement: {
      listOrganizationMemberships: async (opts: Record<string, unknown>) => {
        calls.memberships.push(opts);
        refuse();
        return page(memberships.filter((m) => m.organizationId === opts.organizationId));
      },
      listUsers: async (opts: { organizationId?: string }) => {
        refuse();
        return page(opts.organizationId === ORG ? users : []);
      },
      listInvitations: async (opts: { organizationId?: string }) => {
        refuse();
        return page(invitations.filter((i) => i.organizationId === opts.organizationId));
      },
      sendInvitation: async (payload: Record<string, unknown>) => {
        calls.sent.push(payload);
        return invitation({ id: 'inv_new', email: String(payload.email) });
      },
      revokeInvitation: async (id: string) => {
        calls.revoked.push(id);
        return invitation({ id, email: 'x@acme.test', state: 'revoked' });
      },
      deleteOrganizationMembership: async (id: string) => {
        calls.deleted.push(id);
      },
    },
  };
  return { workos, calls };
}

const cfg = { appUrl: 'http://localhost:3000' };
let links: MemoryInviteLinkStore;

function makeApp(workos: unknown, user: AuthUser | null): Express {
  links = new MemoryInviteLinkStore();
  const app = express();
  app.use(express.json());
  // What the auth gate puts on the request, without the gate: these routes read
  // the caller and their organization off `req.user` and nothing else.
  app.use((req, _res, next) => {
    if (user) (req as express.Request & { user?: AuthUser }).user = user;
    next();
  });
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  app.use('/api/workspace', createWorkspaceMembersRouter(workos as any, cfg, links));
  return app;
}

beforeEach(() => {
  vi.mocked(captureAction).mockClear();
});

const CALLER: AuthUser = {
  id: ME.id,
  email: ME.email,
  firstName: ME.firstName,
  lastName: ME.lastName,
  organizationId: ORG,
};

describe('GET /api/workspace/members', () => {
  it('composes the memberships with their users, oldest member first', async () => {
    const m = makeWorkos();
    const res = await request(makeApp(m.workos, CALLER)).get('/api/workspace/members').expect(200);

    expect(res.body.members).toEqual([
      {
        id: 'om_me',
        userId: 'user_me',
        name: 'Dana Rees',
        email: 'dana@acme.test',
        joinedAt: '2026-01-01T00:00:00.000Z',
        isSelf: true,
      },
      {
        id: 'om_them',
        userId: 'user_them',
        // No name on the WorkOS user, so the email is the name.
        name: 'sam@acme.test',
        email: 'sam@acme.test',
        joinedAt: '2026-03-01T00:00:00.000Z',
        isSelf: false,
      },
    ]);
    // Only the workspace's own, and only the active ones.
    expect(m.calls.memberships[0]).toEqual({ organizationId: ORG, statuses: ['active'] });
  });

  it('drops a membership that is not active', async () => {
    const m = makeWorkos({
      memberships: [
        membership({ id: 'om_me', userId: ME.id }),
        membership({ id: 'om_gone', userId: THEM.id, status: 'inactive' }),
      ],
    });
    const res = await request(makeApp(m.workos, CALLER)).get('/api/workspace/members').expect(200);
    expect(res.body.members.map((x: { id: string }) => x.id)).toEqual(['om_me']);
  });

  it('lists the open invitations newest first, expired by their date, and no other state', async () => {
    const m = makeWorkos({
      invitations: [
        invitation({ id: 'inv_old', email: 'old@acme.test', createdAt: '2026-02-01T00:00:00.000Z' }),
        invitation({
          id: 'inv_new',
          email: 'new@acme.test',
          createdAt: '2026-04-01T00:00:00.000Z',
        }),
        invitation({ id: 'inv_late', email: 'late@acme.test', expiresAt: past, createdAt: '2026-03-01T00:00:00.000Z' }),
        invitation({ id: 'inv_taken', email: 'taken@acme.test', state: 'accepted' }),
        invitation({ id: 'inv_gone', email: 'gone@acme.test', state: 'revoked' }),
      ],
    });
    const res = await request(makeApp(m.workos, CALLER)).get('/api/workspace/members').expect(200);

    expect(res.body.invitations).toEqual([
      {
        id: 'inv_new',
        email: 'new@acme.test',
        state: 'pending',
        expiresAt: soon,
        createdAt: '2026-04-01T00:00:00.000Z',
        acceptUrl: 'https://workos.test/invite/inv_new',
      },
      {
        id: 'inv_late',
        email: 'late@acme.test',
        state: 'expired',
        expiresAt: past,
        createdAt: '2026-03-01T00:00:00.000Z',
        acceptUrl: 'https://workos.test/invite/inv_late',
      },
      {
        id: 'inv_old',
        email: 'old@acme.test',
        state: 'pending',
        expiresAt: soon,
        createdAt: '2026-02-01T00:00:00.000Z',
        acceptUrl: 'https://workos.test/invite/inv_old',
      },
    ]);
  });

  it('says why WorkOS refused, as a bad gateway', async () => {
    const m = makeWorkos({ fail: 'WorkOS is unavailable' });
    const res = await request(makeApp(m.workos, CALLER)).get('/api/workspace/members').expect(502);
    expect(res.body.error).toBe('WorkOS is unavailable');
  });
});

describe('POST /api/workspace/invitations', () => {
  let m: ReturnType<typeof makeWorkos>;
  let app: Express;

  beforeEach(() => {
    m = makeWorkos({
      invitations: [invitation({ id: 'inv_open', email: 'waiting@acme.test' })],
    });
    app = makeApp(m.workos, CALLER);
  });

  it('sends the invitation with the caller as inviter, for seven days', async () => {
    const res = await request(app)
      .post('/api/workspace/invitations')
      .send({ email: '  New.Person@Acme.test ' })
      .expect(201);

    expect(m.calls.sent).toEqual([
      {
        email: 'new.person@acme.test',
        organizationId: ORG,
        inviterUserId: ME.id,
        expiresInDays: 7,
      },
    ]);
    expect(res.body.invitation).toMatchObject({
      id: 'inv_new',
      email: 'new.person@acme.test',
      state: 'pending',
      acceptUrl: 'https://workos.test/invite/inv_new',
    });
  });

  it('refuses what cannot be an email, without asking WorkOS', async () => {
    for (const email of ['', '   ', 'nobody', 'two@at@acme.test', 'a b@acme.test', '@acme.test', 'sam@', 42]) {
      const res = await request(app).post('/api/workspace/invitations').send({ email }).expect(400);
      expect(res.body.error).toBe('Enter an email address.');
    }
    expect(m.calls.sent).toEqual([]);
  });

  it('refuses someone who is already in the workspace', async () => {
    const res = await request(app)
      .post('/api/workspace/invitations')
      .send({ email: 'SAM@acme.test' })
      .expect(409);
    expect(res.body.error).toBe('That person is already in this workspace.');
    expect(m.calls.sent).toEqual([]);
  });

  it('refuses an email that already has an invitation standing', async () => {
    const res = await request(app)
      .post('/api/workspace/invitations')
      .send({ email: 'waiting@acme.test' })
      .expect(409);
    expect(res.body.error).toBe('That email already has an invitation.');
    expect(m.calls.sent).toEqual([]);
  });

  it('invites again once the old invitation has expired', async () => {
    const expired = makeWorkos({
      invitations: [invitation({ id: 'inv_old', email: 'waiting@acme.test', expiresAt: past })],
    });
    await request(makeApp(expired.workos, CALLER))
      .post('/api/workspace/invitations')
      .send({ email: 'waiting@acme.test' })
      .expect(201);
    expect(expired.calls.sent).toHaveLength(1);
  });
});

describe('DELETE /api/workspace/invitations/:id', () => {
  it('revokes one of this workspace’s invitations', async () => {
    const m = makeWorkos({ invitations: [invitation({ id: 'inv_open', email: 'waiting@acme.test' })] });
    await request(makeApp(m.workos, CALLER))
      .delete('/api/workspace/invitations/inv_open')
      .expect(204);
    expect(m.calls.revoked).toEqual(['inv_open']);
  });

  it('does not know an invitation of another workspace', async () => {
    const m = makeWorkos({
      invitations: [
        invitation({ id: 'inv_elsewhere', email: 'x@other.test', organizationId: 'org_other' }),
      ],
    });
    await request(makeApp(m.workos, CALLER))
      .delete('/api/workspace/invitations/inv_elsewhere')
      .expect(404);
    expect(m.calls.revoked).toEqual([]);
  });
});

describe('DELETE /api/workspace/members/:id', () => {
  it('removes another member', async () => {
    const m = makeWorkos();
    await request(makeApp(m.workos, CALLER)).delete('/api/workspace/members/om_them').expect(204);
    expect(m.calls.deleted).toEqual(['om_them']);
  });

  it('never removes the caller themselves', async () => {
    const m = makeWorkos();
    const res = await request(makeApp(m.workos, CALLER))
      .delete('/api/workspace/members/om_me')
      .expect(400);
    expect(res.body.error).toBe('You cannot remove yourself from the workspace.');
    expect(m.calls.deleted).toEqual([]);
  });

  it('never removes the last member', async () => {
    const m = makeWorkos({
      memberships: [membership({ id: 'om_them', userId: THEM.id })],
      users: [THEM],
    });
    const res = await request(makeApp(m.workos, CALLER))
      .delete('/api/workspace/members/om_them')
      .expect(400);
    expect(res.body.error).toBe('The last member of a workspace cannot be removed.');
    expect(m.calls.deleted).toEqual([]);
  });

  it('does not know a membership of another workspace', async () => {
    const m = makeWorkos();
    await request(makeApp(m.workos, CALLER)).delete('/api/workspace/members/om_elsewhere').expect(404);
    expect(m.calls.deleted).toEqual([]);
  });
});

describe('a session with no workspace', () => {
  const cases: Array<[string, (app: Express) => Promise<unknown>]> = [
    ['GET /members', (app) => request(app).get('/api/workspace/members').expect(401)],
    [
      'POST /invitations',
      (app) =>
        request(app)
          .post('/api/workspace/invitations')
          .send({ email: 'a@acme.test' })
          .expect(401),
    ],
    [
      'DELETE /invitations/:id',
      (app) => request(app).delete('/api/workspace/invitations/inv_1').expect(401),
    ],
    ['DELETE /members/:id', (app) => request(app).delete('/api/workspace/members/om_1').expect(401)],
  ];

  for (const [name, call] of cases) {
    it(`refuses ${name} with 401`, async () => {
      const orgLess = makeWorkos();
      await call(makeApp(orgLess.workos, { id: ME.id, email: ME.email }));

      const anon = makeWorkos();
      await call(makeApp(anon.workos, null));
      expect(anon.calls.sent).toEqual([]);
      expect(anon.calls.deleted).toEqual([]);
    });
  }
});

describe('invite links', () => {
  it('mints a link for the chosen days, addressed to the invite page', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos, CALLER);
    const before = Date.now();

    const res = await request(app)
      .post('/api/workspace/invite-links')
      .send({ expiresInDays: 3 })
      .expect(201);

    const stored = [...links.rows.values()];
    expect(stored).toHaveLength(1);
    // The sender's name rides the row: the invite page shows it without asking WorkOS.
    expect(stored[0]).toMatchObject({ workspaceOrgId: ORG, inviterUserId: ME.id, inviterName: 'Dana Rees' });
    expect(res.body.link).toMatchObject({
      id: stored[0]!.id,
      url: `http://localhost:3000/invite/${stored[0]!.token}`,
      state: 'pending',
    });
    const life = Date.parse(res.body.link.expiresAt) - before;
    expect(life).toBeGreaterThan(3 * DAY - 5000);
    expect(life).toBeLessThanOrEqual(3 * DAY + 5000);

    // Reported once the row exists: how long it stands, never the token or the URL.
    expect(captureAction).toHaveBeenCalledTimes(1);
    expect(captureAction).toHaveBeenCalledWith(EVENTS.inviteLinkCreated, {
      userId: ME.id,
      workspaceId: ORG,
      properties: { days: 3 },
    });
  });

  it.each([undefined, 0, 2, 31, 2.5, '7'])('refuses %j as a lifetime', async (expiresInDays) => {
    const m = makeWorkos();
    const app = makeApp(m.workos, CALLER);
    await request(app).post('/api/workspace/invite-links').send({ expiresInDays }).expect(400);
    expect(links.rows.size).toBe(0);
    expect(captureAction).not.toHaveBeenCalled();
  });

  it('lists the standing links after the invitations, newest first, an old one marked expired', async () => {
    const m = makeWorkos({ invitations: [invitation({ id: 'inv_1', email: 'kim@acme.test' })] });
    const app = makeApp(m.workos, CALLER);
    links.seed({ workspaceOrgId: ORG, token: 'old', expiresAt: past, createdAt: '2026-01-01T00:00:00.000Z' });
    links.seed({ workspaceOrgId: ORG, token: 'new', createdAt: '2026-02-01T00:00:00.000Z' });
    links.seed({ workspaceOrgId: ORG, token: 'used', consumedAt: soon, consumedByUserId: 'user_x' });
    links.seed({ workspaceOrgId: 'org_other', token: 'theirs' });

    const res = await request(app).get('/api/workspace/members').expect(200);

    expect(res.body.invitations).toHaveLength(1);
    expect(res.body.inviteLinks.map((l: { url: string; state: string }) => [l.url, l.state])).toEqual([
      ['http://localhost:3000/invite/new', 'pending'],
      ['http://localhost:3000/invite/old', 'expired'],
    ]);
  });

  it('revokes one of this workspace’s links, and knows nothing of another’s', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos, CALLER);
    const mine = links.seed({ workspaceOrgId: ORG });
    const theirs = links.seed({ workspaceOrgId: 'org_other' });

    await request(app).delete(`/api/workspace/invite-links/${theirs.id}`).expect(404);
    await request(app).delete(`/api/workspace/invite-links/${mine.id}`).expect(204);

    expect([...links.rows.keys()]).toEqual([theirs.id]);
  });

  it('refuses a session with no workspace', async () => {
    const m = makeWorkos();
    const app = makeApp(m.workos, { id: ME.id, email: ME.email, organizationId: null });
    await request(app).post('/api/workspace/invite-links').send({ expiresInDays: 7 }).expect(401);
  });
});
