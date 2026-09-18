/**
 * Settings › Members: the workspace's people, and the invitations on their way.
 *
 * Everything on the tab is the server's: the rows come from
 * `GET /api/workspace/members`, and Invite, Revoke and Remove are one request
 * each followed by a re-read, so what the page shows afterwards is what the
 * server answered. The two removals nobody could undo are not offered at all:
 * your own row has no Remove, and the last member's is disabled.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { WorkspaceInvitation, WorkspaceInviteLink, WorkspaceMember } from '@truecourse/shared';
import { AuthProvider } from '@/auth/AuthContext';
import DashboardApp from '@/dashboard/DashboardApp';

vi.mock('@/lib/socket', () => {
  const socket = { connected: false, on: vi.fn(), off: vi.fn(), emit: vi.fn(), connect: vi.fn() };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const USER = {
  id: 'user_me',
  email: 'dana@acme.dev',
  firstName: 'Dana',
  lastName: 'Rees',
  organizationId: 'org_1',
  organizationName: 'Northwind Labs',
};

const ME: WorkspaceMember = {
  id: 'om_me',
  userId: 'user_me',
  name: 'Dana Rees',
  email: 'dana@acme.dev',
  joinedAt: '2026-01-01T00:00:00.000Z',
  isSelf: true,
};

const THEM: WorkspaceMember = {
  id: 'om_them',
  userId: 'user_them',
  name: 'Sam Okoro',
  email: 'sam@acme.dev',
  joinedAt: '2026-03-01T00:00:00.000Z',
  isSelf: false,
};

const WAITING: WorkspaceInvitation = {
  id: 'inv_1',
  email: 'kim@acme.dev',
  state: 'pending',
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-04-01T00:00:00.000Z',
  acceptUrl: 'https://workos.test/invite/inv_1',
};

const LAPSED: WorkspaceInvitation = {
  id: 'inv_2',
  email: 'lee@acme.dev',
  state: 'expired',
  expiresAt: '2026-02-01T00:00:00.000Z',
  createdAt: '2026-01-15T00:00:00.000Z',
  acceptUrl: 'https://workos.test/invite/inv_2',
};

const OPEN_LINK: WorkspaceInviteLink = {
  id: 'link_1',
  url: 'http://localhost:3000/invite/tok_1',
  state: 'pending',
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-04-02T00:00:00.000Z',
};

const realFetch = window.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** What the server holds, and what it said to each write. */
interface World {
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
  inviteLinks: WorkspaceInviteLink[];
  /** The answer to POST /invitations; the default one accepts. */
  invite: (email: string) => Response;
  posted: string[];
  /** The lifetimes asked of POST /invite-links. */
  linkDays: number[];
  deleted: string[];
}

let world: World;

function serve(over: Partial<World> = {}) {
  world = {
    members: [ME, THEM],
    invitations: [WAITING, LAPSED],
    invite: (email) => {
      const invitation: WorkspaceInvitation = {
        id: 'inv_new',
        email,
        state: 'pending',
        expiresAt: '2099-01-01T00:00:00.000Z',
        createdAt: '2026-05-01T00:00:00.000Z',
        acceptUrl: 'https://workos.test/invite/inv_new',
      };
      world.invitations = [invitation, ...world.invitations];
      return json({ invitation }, 201);
    },
    inviteLinks: [],
    posted: [],
    linkDays: [],
    deleted: [],
    ...over,
  };

  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    const method = init?.method ?? 'GET';

    if (pathname === '/api/auth/me') return json({ user: USER });
    if (pathname === '/api/workspace/members' && method === 'GET') {
      return json({
        members: world.members,
        invitations: world.invitations,
        inviteLinks: world.inviteLinks,
      });
    }
    if (pathname === '/api/workspace/invite-links' && method === 'POST') {
      const days = (JSON.parse(String(init?.body)) as { expiresInDays: number }).expiresInDays;
      world.linkDays.push(days);
      const link: WorkspaceInviteLink = {
        id: 'link_new',
        url: 'http://localhost:3000/invite/tok_new',
        state: 'pending',
        expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString(),
        createdAt: '2026-05-02T00:00:00.000Z',
      };
      world.inviteLinks = [link, ...world.inviteLinks];
      return json({ link }, 201);
    }
    if (pathname.startsWith('/api/workspace/invite-links/') && method === 'DELETE') {
      const id = pathname.slice('/api/workspace/invite-links/'.length);
      world.deleted.push(id);
      world.inviteLinks = world.inviteLinks.filter((l) => l.id !== id);
      return new Response(null, { status: 204 });
    }
    if (pathname === '/api/workspace/invitations' && method === 'POST') {
      const email = (JSON.parse(String(init?.body)) as { email: string }).email;
      world.posted.push(email);
      return world.invite(email);
    }
    if (pathname.startsWith('/api/workspace/invitations/') && method === 'DELETE') {
      const id = pathname.slice('/api/workspace/invitations/'.length);
      world.deleted.push(id);
      world.invitations = world.invitations.filter((i) => i.id !== id);
      return new Response(null, { status: 204 });
    }
    if (pathname.startsWith('/api/workspace/members/') && method === 'DELETE') {
      const id = pathname.slice('/api/workspace/members/'.length);
      world.deleted.push(id);
      world.members = world.members.filter((m) => m.id !== id);
      return new Response(null, { status: 204 });
    }
    if (pathname === '/api/repos') return json([]);
    if (pathname === '/api/sessions/runs') return json({ runs: [] });
    if (pathname === '/api/llm/config') return json({ config: null, providers: ['anthropic'] });
    if (pathname === '/api/github/status') return json({ installations: [], connectUrl: '', repos: [] });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

function renderMembers() {
  window.history.replaceState({}, '', '/settings/members');
  render(
    <MemoryRouter initialEntries={['/settings/members']}>
      <AuthProvider>
        <Routes>
          <Route path="/*" element={<DashboardApp />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/** The one list, once the first read has landed. */
async function rows(): Promise<HTMLElement[]> {
  const list = await screen.findByRole('list', { name: 'Members' });
  return within(list).queryAllByRole('listitem');
}

/** The row the named person is on, waiting for the read that brings it. */
async function rowFor(text: string): Promise<HTMLElement> {
  const list = await screen.findByRole('list', { name: 'Members' });
  const cell = await within(list).findByText(text);
  return cell.closest('li')!;
}

beforeEach(() => serve());

afterEach(() => {
  window.fetch = realFetch;
});

describe('Settings › Members', () => {
  it('lists the members and the open invitations, each with its status word', async () => {
    renderMembers();

    await waitFor(async () => expect(await rows()).toHaveLength(4));
    const list = await screen.findByRole('list', { name: 'Members' });
    const all = within(list).getAllByRole('listitem');

    expect(all[0]).toHaveTextContent('Dana Rees');
    expect(all[0]).toHaveTextContent('dana@acme.dev');
    expect(within(all[0]!).getByText('Member')).toBeInTheDocument();
    expect(all[1]).toHaveTextContent('Sam Okoro');
    // The invitations follow the members, newest first as the server sent them.
    expect(all[2]).toHaveTextContent('kim@acme.dev');
    expect(within(all[2]!).getByText('Invited')).toBeInTheDocument();
    expect(all[3]).toHaveTextContent('lee@acme.dev');
    expect(within(all[3]!).getByText('Expired')).toBeInTheDocument();
  });

  it('narrows to what the search matches, by name and by email', async () => {
    const user = userEvent.setup();
    renderMembers();
    await waitFor(async () => expect(await rows()).toHaveLength(4));

    const search = screen.getByLabelText('Search members');
    await user.type(search, 'sam@');
    await waitFor(async () => expect(await rows()).toHaveLength(1));
    expect((await rows())[0]).toHaveTextContent('Sam Okoro');

    await user.clear(search);
    await user.type(search, 'kim');
    await waitFor(async () => expect(await rows()).toHaveLength(1));
    expect((await rows())[0]).toHaveTextContent('kim@acme.dev');

    await user.clear(search);
    await user.type(search, 'nobody');
    await waitFor(() => expect(screen.getByText('Nothing matches.')).toBeInTheDocument());
    expect(await rows()).toHaveLength(0);
  });

  it('invites one person: the dialog posts the email and the new row arrives with the re-read', async () => {
    const user = userEvent.setup();
    renderMembers();
    await waitFor(async () => expect(await rows()).toHaveLength(4));

    await user.click(screen.getByRole('button', { name: 'Invite by email' }));
    expect(await screen.findByText('Invite by email', { selector: 'h2' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'new@acme.dev');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(world.posted).toEqual(['new@acme.dev']);
    await waitFor(async () => expect(await rows()).toHaveLength(5));
    expect(await rowFor('new@acme.dev')).toBeTruthy();
  });

  it('shows the server’s refusal under the field, and sends nothing more', async () => {
    const user = userEvent.setup();
    serve({ invite: () => json({ error: 'That person is already in this workspace.' }, 409) });
    renderMembers();
    await waitFor(async () => expect(await rows()).toHaveLength(4));

    await user.click(screen.getByRole('button', { name: 'Invite by email' }));
    await user.type(screen.getByLabelText('Email'), 'sam@acme.dev');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(
      await screen.findByText('That person is already in this workspace.'),
    ).toBeInTheDocument();
    // The dialog stands, so the address can be corrected where it was typed.
    expect(screen.getByLabelText('Email')).toHaveValue('sam@acme.dev');
    expect(world.posted).toEqual(['sam@acme.dev']);
    expect(world.invitations).toHaveLength(2);
  });

  it('revokes an invitation and re-reads the list', async () => {
    const user = userEvent.setup();
    renderMembers();
    const invited = await rowFor('kim@acme.dev');

    await user.click(within(invited).getByRole('button', { name: 'Revoke' }));

    expect(world.deleted).toEqual(['inv_1']);
    await waitFor(async () => expect(await rows()).toHaveLength(3));
    expect(screen.queryByText('kim@acme.dev')).toBeNull();
  });

  it('removes another member and re-reads the list', async () => {
    const user = userEvent.setup();
    renderMembers();
    const them = await rowFor('Sam Okoro');

    await user.click(within(them).getByRole('button', { name: 'Remove' }));

    expect(world.deleted).toEqual(['om_them']);
    await waitFor(async () => expect(await rows()).toHaveLength(3));
    expect(screen.queryByText('Sam Okoro')).toBeNull();
  });

  it('offers no Remove on your own row', async () => {
    renderMembers();
    const mine = await rowFor('Dana Rees');
    expect(within(mine).queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('disables Remove on the last member, and says why', async () => {
    serve({ members: [THEM], invitations: [] });
    renderMembers();
    const only = await rowFor('Sam Okoro');

    const remove = within(only).getByRole('button', { name: 'Remove' });
    expect(remove).toBeDisabled();
    expect(
      within(only).getByText('The last member of a workspace cannot be removed.'),
    ).toBeInTheDocument();
    expect(world.deleted).toEqual([]);
  });

  it('copies the invitation’s address and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderMembers();
    const invited = await rowFor('kim@acme.dev');

    await user.click(within(invited).getByRole('button', { name: 'Copy link' }));

    expect(writeText).toHaveBeenCalledWith('https://workos.test/invite/inv_1');
    expect(await within(invited).findByText('Copied')).toBeInTheDocument();
  });

  it('shows why the members could not be read, in place of the list', async () => {
    const failing = 'Authentication required';
    window.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(href, window.location.origin);
      if (pathname === '/api/auth/me') return json({ user: USER });
      if (pathname === '/api/workspace/members') return json({ error: failing }, 401);
      return json({ error: 'not found' }, 404);
    }) as unknown as typeof window.fetch;
    renderMembers();

    expect(await screen.findByText(failing)).toBeInTheDocument();
    expect(await rows()).toHaveLength(0);
  });

  it('asks nobody about members with no session, and lists none', async () => {
    window.history.replaceState({}, '', '/settings/members');
    render(
      <MemoryRouter initialEntries={['/settings/members']}>
        <Routes>
          <Route path="/*" element={<DashboardApp />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await rows()).toHaveLength(0);
    const reads = (window.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (call) => String(call[0]).includes('/api/workspace/members'),
    );
    expect(reads).toEqual([]);
  });
  it('lists an invite link after the invitations, with Copy link and Revoke', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    serve({ inviteLinks: [OPEN_LINK] });
    renderMembers();

    const row = await rowFor('Invite link');
    expect(within(row).getByText('Unused')).toBeInTheDocument();
    expect(within(row).getByText(/^expires /)).toBeInTheDocument();
    await user.click(within(row).getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/invite/tok_1');

    await user.click(within(row).getByRole('button', { name: 'Revoke' }));
    expect(world.deleted).toEqual(['link_1']);
    await waitFor(() => expect(screen.queryByText('Invite link')).toBeNull());
  });

  it('invites by link: the dialog asks for the lifetime, mints the link and offers it to copy', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderMembers();
    await waitFor(async () => expect(await rows()).toHaveLength(4));

    await user.click(screen.getByRole('button', { name: 'Invite by link' }));
    expect(await screen.findByText('Invite by link', { selector: 'h2' })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Link expires in'), '3');
    await user.click(screen.getByRole('button', { name: 'Create link' }));

    expect(world.linkDays).toEqual([3]);
    expect(await screen.findByLabelText('Invite link')).toHaveValue('http://localhost:3000/invite/tok_new');
    await user.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/invite/tok_new');

    // Closing the dialog uncovers the list, re-read with the new row in it.
    await user.keyboard('{Escape}');
    await waitFor(async () => expect(await rows()).toHaveLength(5));
    expect(await rowFor('Invite link')).toBeTruthy();
  });
});

describe('Settings › Members, the invite link rows', () => {
  it('hides the links while a search is on, and brings them back when it is cleared', async () => {
    const user = userEvent.setup();
    serve({ inviteLinks: [OPEN_LINK] });
    renderMembers();
    await rowFor('Invite link');

    await user.type(screen.getByLabelText('Search members'), 'sam');
    expect(await rowFor('Sam Okoro')).toBeTruthy();
    expect(screen.queryByText('Invite link')).toBeNull();

    await user.clear(screen.getByLabelText('Search members'));
    expect(await rowFor('Invite link')).toBeTruthy();
  });

  it('marks a link past its date Expired, once, and still offers Revoke', async () => {
    serve({
      inviteLinks: [{ ...OPEN_LINK, state: 'expired', expiresAt: '2026-01-01T00:00:00.000Z' }],
    });
    renderMembers();

    const row = await rowFor('Invite link');
    expect(within(row).getByText('Expired')).toBeInTheDocument();
    // The status word says it; the row does not say "expires expired" beside it.
    expect(within(row).queryByText(/expires/)).toBeNull();
    expect(within(row).getByRole('button', { name: 'Revoke' })).toBeEnabled();
  });

  it('shows the address for copying by hand when the browser refuses the clipboard', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, 'clipboard', {
      value: {
        writeText: vi.fn(async () => {
          throw new Error('denied');
        }),
      },
      configurable: true,
    });
    serve({ inviteLinks: [OPEN_LINK] });
    renderMembers();

    // On the row: the URL takes the place of the expiry.
    const row = await rowFor('Invite link');
    await user.click(within(row).getByRole('button', { name: 'Copy link' }));
    expect(await within(row).findByText('http://localhost:3000/invite/tok_1')).toBeInTheDocument();
    expect(within(row).queryByText('Copied')).toBeNull();

    // In the dialog: the field is already there, so the page says to use it.
    await user.click(screen.getByRole('button', { name: 'Invite by link' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }));
    await within(dialog).findByLabelText('Invite link');
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(await within(dialog).findByText(/Copy failed/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Copied')).toBeNull();
  });

  it('acknowledges a copy from the dialog and from the row', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });
    serve({ inviteLinks: [OPEN_LINK] });
    renderMembers();

    const row = await rowFor('Invite link');
    await user.click(within(row).getByRole('button', { name: 'Copy link' }));
    expect(await within(row).findByText('Copied')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Invite by link' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }));
    await within(dialog).findByLabelText('Invite link');
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(await within(dialog).findByText('Copied')).toBeInTheDocument();
  });

  it('says why a link could not be minted, in the dialog', async () => {
    const user = userEvent.setup();
    serve();
    const fetchWithWorld = window.fetch;
    window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (new URL(href, window.location.origin).pathname === '/api/workspace/invite-links' && init?.method === 'POST') {
        return json({ error: 'WorkOS refused: rate limited' }, 502);
      }
      return fetchWithWorld(input, init);
    }) as unknown as typeof window.fetch;
    renderMembers();
    await rowFor('Dana Rees');

    await user.click(screen.getByRole('button', { name: 'Invite by link' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }));

    expect(await within(dialog).findByText('WorkOS refused: rate limited')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Invite link')).toBeNull();
    expect(world.inviteLinks).toEqual([]);
  });
});
