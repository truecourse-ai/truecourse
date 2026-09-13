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
import type { WorkspaceInvitation, WorkspaceMember } from '@truecourse/shared';
import { AuthProvider } from '@/ee/AuthContext';
import PreviewApp from '@/preview/PreviewApp';

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

const realFetch = window.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** What the server holds, and what it said to each write. */
interface World {
  members: WorkspaceMember[];
  invitations: WorkspaceInvitation[];
  /** The answer to POST /invitations; the default one accepts. */
  invite: (email: string) => Response;
  posted: string[];
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
    posted: [],
    deleted: [],
    ...over,
  };

  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    const method = init?.method ?? 'GET';

    if (pathname === '/api/auth/me') return json({ user: USER });
    if (pathname === '/api/workspace/members' && method === 'GET') {
      return json({ members: world.members, invitations: world.invitations });
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
    if (pathname === '/api/github/status') return json({ installations: [], installUrl: '', repos: [] });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

function renderMembers() {
  window.history.replaceState({}, '', '/preview/settings/members');
  render(
    <MemoryRouter initialEntries={['/preview/settings/members']}>
      <AuthProvider>
        <Routes>
          <Route path="/preview/*" element={<PreviewApp />} />
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

    await user.click(screen.getByRole('button', { name: 'Invite member' }));
    expect(await screen.findByText('Invite member', { selector: 'h2' })).toBeInTheDocument();

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

    await user.click(screen.getByRole('button', { name: 'Invite member' }));
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
    window.history.replaceState({}, '', '/preview/settings/members');
    render(
      <MemoryRouter initialEntries={['/preview/settings/members']}>
        <Routes>
          <Route path="/preview/*" element={<PreviewApp />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await rows()).toHaveLength(0);
    const reads = (window.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (call) => String(call[0]).includes('/api/workspace/members'),
    );
    expect(reads).toEqual([]);
  });
});
