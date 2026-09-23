/**
 * Add context, for a tool the workspace connects an account to.
 *
 * WHICH kinds are offered is the server's answer (`addableKinds`), and which
 * TOOLS are offered is the workspace's connections: ONE connected account is a
 * row PER SOURCE KIND it serves — an Atlassian login offers Jira and
 * Confluence, each named by the site it reads — and a kind this server cannot
 * add is no row at all. An unconnected account is no row either, and the list
 * ends with the one link that goes where it is connected.
 *
 * The edition that has Connections is what registers that Settings section, so
 * this file registers one — the dialog is the open shell's, and it must say
 * nothing about a section this deployment has not got.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import type { ContextConnectionView, ContextSourceKind } from '@truecourse/shared';

vi.mock('@/lib/socket', () => {
  const socket = {
    connected: false,
    on: () => socket,
    off: () => socket,
    emit: vi.fn(),
    connect: vi.fn(),
  };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

import DashboardApp from '@/dashboard/DashboardApp';
import { registerSettingsTab, registerSourceKindMark } from '@/dashboard/shell/registry';

// An edition with document Connections. Registration is module-level, as the
// real one is, and vitest isolates this file from every other. It registers a
// mark for Jira and none for Confluence, so both branches of the row render.
registerSettingsTab({ id: 'connections', label: 'Connections', render: () => null });
registerSourceKindMark('jira', 'data:image/svg+xml,jira-mark');

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const connection = (connected: boolean): ContextConnectionView => ({
  provider: 'atlassian',
  kinds: ['jira', 'confluence'],
  connected,
  baseUrl: connected ? 'https://acme.atlassian.net' : '',
  accountEmail: connected ? 'u@acme.test' : '',
  tokenMask: connected ? '••••oken' : null,
  updatedAt: connected ? '2026-09-16T10:00:00.000Z' : null,
});

interface World {
  addableKinds: ContextSourceKind[];
  connections: ContextConnectionView[];
  calls: { method: string; path: string; body: unknown }[];
}

function serve(over: Partial<World> = {}): World {
  const state: World = {
    addableKinds: ['repository', 'site', 'jira', 'confluence'],
    connections: [connection(true)],
    calls: [],
    ...over,
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method !== 'GET') state.calls.push({ method, path: pathname, body });

    if (pathname === '/api/repos') return json([]);
    if (pathname === '/api/llm/config') {
      return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    }
    if (pathname === '/api/sessions/runs') return json({ runs: [] });
    if (pathname === '/api/connections') return json({ connections: state.connections });
    if (pathname === '/api/context/sources' && method === 'GET') {
      return json({ sources: [], changedAt: null, addableKinds: state.addableKinds });
    }
    if (pathname === '/api/context/documents') return json({ documents: [], corpusAt: null });
    if (pathname === '/api/context/staleness') {
      return json({ changedAt: null, corpusAt: null, stale: false });
    }
    if (pathname === '/api/context/sources/preview') {
      return json({ title: 'ENG (Jira)', count: 2, titles: ['ENG-1: Orders'], skipped: [] });
    }
    if (pathname === '/api/context/sources' && method === 'POST') {
      return json({ source: { id: 'jira-acme-atlassian-net-eng' }, jobId: 'job-sync' }, 202);
    }
    return json({ error: `not found: ${pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

function renderContext() {
  window.history.replaceState({}, '', '/context');
  render(
    <MemoryRouter initialEntries={['/context']}>
      <Routes>
        <Route path="/*" element={<DashboardApp />} />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  );
}

/** Open the dialog on its first step and hand back the list of kinds. */
async function openKinds(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Add context' }));
  return screen.findByRole('list', { name: 'Kinds of source' });
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('the kinds the dialog offers', () => {
  it('offers one row per kind the connected account serves, above the kinds that need none', async () => {
    serve();
    renderContext();
    const list = await openKinds();

    await waitFor(() => expect(within(list).getByText('Jira')).toBeInTheDocument());
    expect(within(list).getByText('Confluence')).toBeInTheDocument();
    // Each names the site the one account reads.
    expect(within(list).getAllByText('https://acme.atlassian.net')).toHaveLength(2);
    // The account's two kinds, then the two kinds that need no account.
    expect(within(list).getAllByRole('button')).toHaveLength(4);
    expect(within(list).getByRole('link')).toHaveTextContent('Connect another tool in Settings');
    // A kind wears the mark its edition registered; one without gets the generic icon.
    const [jira, confluence] = within(list).getAllByRole('button');
    expect(jira!.querySelector('img')?.getAttribute('src')).toBe('data:image/svg+xml,jira-mark');
    expect(confluence!.querySelector('img')).toBeNull();
    expect(confluence!.querySelector('svg')).not.toBeNull();
  });

  it('leaves out a kind the account serves but this server cannot add', async () => {
    serve({ addableKinds: ['repository', 'site', 'jira'] });
    renderContext();
    const list = await openKinds();

    await waitFor(() => expect(within(list).getByText('Jira')).toBeInTheDocument());
    expect(within(list).queryByText('Confluence')).toBeNull();
    expect(within(list).getAllByRole('button')).toHaveLength(3);
  });

  it('offers no tool at all when the workspace has connected none', async () => {
    serve({ connections: [connection(false)] });
    renderContext();
    const list = await openKinds();

    await waitFor(() =>
      expect(within(list).getByRole('link')).toHaveTextContent('Connect a tool in Settings'),
    );
    expect(within(list).getByRole('link')).toHaveAttribute('href', '/settings/connections');
    expect(within(list).queryByText('Jira')).toBeNull();
  });

  it('asks nothing of a server that drives no tool', async () => {
    const state = serve({ addableKinds: ['repository', 'site'] });
    renderContext();
    const list = await openKinds();

    await waitFor(() => expect(within(list).getByText('Documentation site')).toBeInTheDocument());
    expect(within(list).queryByText('Jira')).toBeNull();
    expect(vi.mocked(window.fetch).mock.calls.map((call) => String(call[0]))).not.toContain(
      '/api/connections',
    );
    expect(state.calls).toEqual([]);
  });
});

describe('adding a Jira source', () => {
  it('checks the project before it is stored, then adds it', async () => {
    const state = serve();
    renderContext();
    const user = userEvent.setup();
    const list = await openKinds();

    await waitFor(() => expect(within(list).getByText('Jira')).toBeInTheDocument());
    await user.click(within(list).getByText('Jira'));

    await user.type(screen.getByRole('textbox', { name: 'Project key' }), 'ENG');
    await user.type(screen.getByRole('textbox', { name: 'JQL filter' }), 'labels = spec');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/ENG \(Jira\) yields 2 issues/)).toBeInTheDocument();
    expect(state.calls[0]).toEqual({
      method: 'POST',
      path: '/api/context/sources/preview',
      body: { kind: 'jira', config: { projectKey: 'ENG', jql: 'labels = spec' } },
    });

    await user.click(screen.getByRole('button', { name: 'Add and sync' }));
    await waitFor(() =>
      expect(state.calls[1]).toEqual({
        method: 'POST',
        path: '/api/context/sources',
        body: { kind: 'jira', config: { projectKey: 'ENG', jql: 'labels = spec' }, repoIds: [] },
      }),
    );
  });

  it('will not check a project that has not been named', async () => {
    serve();
    renderContext();
    const user = userEvent.setup();
    const list = await openKinds();

    await waitFor(() => expect(within(list).getByText('Jira')).toBeInTheDocument());
    await user.click(within(list).getByText('Jira'));
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
  });
});
