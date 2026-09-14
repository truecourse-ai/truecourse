/**
 * What the dashboard does when the server says it runs locally.
 *
 * The client learns the mode from the server's own description of itself
 * (`GET /api/capabilities`), and two things follow: the folder on this machine
 * is offered as a repository provider, and everything that assumes an identity
 * provider — Sign out, Invite member — is not drawn, because there is nothing
 * behind it. A hosted server is unchanged, which is the other half of each case.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CapabilitiesResponse, ServerMode } from '@truecourse/shared';
import { AuthProvider } from '@/auth/AuthContext';
import { AppProvider } from '@/contexts/CapabilityContext';
import { offeredRepositoryProviders, repositoryProviders } from '@/preview/data/providers';
import { toPreviewRepo } from '@/preview/data/real-repos';
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
  id: 'user_local',
  email: '',
  firstName: 'dana',
  organizationId: 'org_local',
  organizationName: 'Local',
};

const FOLDER = { repoFullName: 'local/orders-api', path: '/Users/dana/code/orders-api', connectedAt: '2026-05-01T00:00:00.000Z' };

const realFetch = window.fetch;

/** What the connect dialog posted, so the flow can be read back. */
let connected: string[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function serve(mode: ServerMode) {
  connected = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    const method = init?.method ?? 'GET';
    if (pathname === '/api/auth/me') return json({ user: USER });
    if (pathname === '/api/local/repos' && method === 'POST') {
      connected.push((JSON.parse(String(init?.body)) as { path: string }).path);
      return json({ repoFullName: 'local/orders-api' }, 201);
    }
    if (pathname === '/api/local/repos') return json({ repos: mode === 'local' ? [FOLDER] : [] });
    if (pathname === '/api/context/sources') return json({ sources: [] });
    if (pathname === '/api/repos') return json([]);
    if (pathname === '/api/sessions/runs') return json({ runs: [] });
    if (pathname === '/api/llm/config') return json({ config: null, providers: ['anthropic'] });
    if (pathname === '/api/github/status') return json({ installations: [], installUrl: '', repos: [] });
    if (pathname === '/api/workspace/members') return json({ members: [], invitations: [] });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

function renderAt(path: string, mode: ServerMode) {
  const capabilities: CapabilitiesResponse = { edition: 'community', mode, capabilities: [] };
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProvider initial={capabilities}>
        <AuthProvider>
          <Routes>
            <Route path="/*" element={<PreviewApp />} />
          </Routes>
        </AuthProvider>
      </AppProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  window.fetch = realFetch;
});

describe('the providers a server offers', () => {
  it('offers the folder on this machine only when the server is local', () => {
    expect(offeredRepositoryProviders('local').map((p) => p.id)).toContain('local');
    expect(offeredRepositoryProviders('hosted').map((p) => p.id)).not.toContain('local');
    // It is still a provider either way, so a repository connected from one
    // draws with its own name and mark wherever it is listed.
    expect(repositoryProviders().map((p) => p.id)).toContain('local');
  });

  it('gives the folder provider its own connect step, which is what the dialog renders', () => {
    const local = repositoryProviders().find((p) => p.id === 'local');
    expect(local?.connect?.Picker).toBeTypeOf('function');
    expect(local?.connect?.summary).toBeTruthy();
  });
});

describe('a connected folder, as Code lists it', () => {
  it('takes its name and its provider from the server, and draws no branch', () => {
    const repo = toPreviewRepo({
      id: 'local-orders-api',
      name: 'local/orders-api',
      path: 'local/orders-api',
      provider: 'local',
      remoteUrl: '/Users/dana/code/orders-api',
    });
    expect(repo).toMatchObject({
      id: 'local-orders-api',
      fullName: 'local/orders-api',
      provider: 'local',
      // A folder tracks no branch: a run reads whatever is checked out.
      defaultBranch: '',
    });
  });
});

describe('Settings › Repositories', () => {
  beforeEach(() => serve('local'));

  it('lists the folder provider with what this machine has connected', async () => {
    renderAt('/settings/repositories', 'local');

    const providers = await screen.findByRole('list', { name: 'Providers' });
    const rows = within(providers).getAllByRole('listitem');
    const folderRow = rows.find((row) => row.textContent?.includes('Local folder'));
    expect(folderRow).toBeDefined();

    await waitFor(() => expect(folderRow!).toHaveTextContent('local/orders-api'));
    expect(folderRow!).toHaveTextContent('/Users/dana/code/orders-api');
    expect(within(folderRow!).getByText('Add folder')).toBeInTheDocument();
  });

  it('does not list it on a hosted server', async () => {
    serve('hosted');
    renderAt('/settings/repositories', 'hosted');

    const providers = await screen.findByRole('list', { name: 'Providers' });
    expect(within(providers).queryByText('Local folder')).toBeNull();
    expect(within(providers).getByText('GitHub')).toBeInTheDocument();
  });
});

describe('connecting a folder', () => {
  it('takes a path in the dialog and connects it, with no account anywhere', async () => {
    serve('local');
    renderAt('/code?connect=1', 'local');

    // Step 1: the providers that connect from here. There is no GitHub account,
    // and the folder does not need one.
    const folderRow = await screen.findByRole('button', { name: /Local folder/ });
    await userEvent.click(folderRow);

    // Step 2: the provider's own step — a path, not a repository list.
    const path = await screen.findByLabelText(/full path on this machine/i);
    await userEvent.type(path, '/Users/dana/code/orders-api');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    // Step 3: the workspace's context, of which there is none yet.
    await userEvent.click(await screen.findByRole('button', { name: 'Continue' }));

    // Step 4: confirm.
    await userEvent.click(
      await screen.findByRole('button', { name: 'Connect and start onboarding' }),
    );

    await waitFor(() => expect(connected).toEqual(['/Users/dana/code/orders-api']));
  });
});

describe('the account menu', () => {
  it('offers no sign-out on a local server', async () => {
    serve('local');
    renderAt('/settings/members', 'local');

    const menu = await screen.findByRole('button', { name: 'Account menu' });
    await userEvent.click(menu);
    expect(screen.queryByText('Sign out')).toBeNull();
    // The theme toggle is still there: it is nobody's session.
    expect(screen.getByText(/mode$/i)).toBeInTheDocument();
  });

  it('offers it on a hosted one', async () => {
    serve('hosted');
    renderAt('/settings/members', 'hosted');

    const menu = await screen.findByRole('button', { name: 'Account menu' });
    await userEvent.click(menu);
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });
});

describe('Invite member', () => {
  it('is not offered locally: there is nothing to send an invitation through', async () => {
    serve('local');
    renderAt('/settings/members', 'local');
    await screen.findByRole('button', { name: 'Account menu' });
    expect(screen.queryByRole('button', { name: 'Invite member' })).toBeNull();
  });

  it('is offered on a hosted server', async () => {
    serve('hosted');
    renderAt('/settings/members', 'hosted');
    expect(await screen.findByRole('button', { name: 'Invite member' })).toBeInTheDocument();
  });
});
