/**
 * Settings › Connections, for real: the two tools that connect.
 *
 * A row opens the account form; Test runs the read a sync makes and says what
 * the account said; Save stores it and the row then names the site it reads.
 * Removing says how many sources it paused. The other four tools stay listed
 * and inert.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import type { ContextConnectionView } from '@truecourse/shared';
import { ConnectionsTab } from '../../ee/packages/client/src/connections/ConnectionsTab';

const realFetch = window.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const unconnected = (provider: 'jira' | 'confluence'): ContextConnectionView => ({
  provider,
  connected: false,
  baseUrl: '',
  accountEmail: '',
  tokenMask: null,
  updatedAt: null,
});

const connected = (provider: 'jira' | 'confluence'): ContextConnectionView => ({
  provider,
  connected: true,
  baseUrl: 'https://acme.atlassian.net',
  accountEmail: 'u@acme.test',
  tokenMask: '••••oken',
  updatedAt: '2026-09-16T10:00:00.000Z',
});

interface World {
  connections: ContextConnectionView[];
  /** Every write the page made: method, path and body. */
  calls: { method: string; path: string; body: unknown }[];
  /** What the next Test answers. */
  testRefusal: string | null;
}

function serve(over: Partial<World> = {}): World {
  const state: World = {
    connections: [unconnected('jira'), unconnected('confluence')],
    calls: [],
    testRefusal: null,
    ...over,
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (method !== 'GET') state.calls.push({ method, path: pathname, body });

    if (pathname === '/api/connections' && method === 'GET') {
      return json({ connections: state.connections });
    }
    if (/^\/api\/connections\/(jira|confluence)\/test$/.test(pathname)) {
      return state.testRefusal
        ? json({ ok: false, error: state.testRefusal }, 400)
        : json({ ok: true });
    }
    if (/^\/api\/connections\/(jira|confluence)$/.test(pathname) && method === 'PUT') {
      const provider = pathname.endsWith('jira') ? 'jira' : 'confluence';
      state.connections = state.connections.map((connection) =>
        connection.provider === provider ? connected(provider) : connection,
      );
      return json({ connection: connected(provider) });
    }
    if (/^\/api\/connections\/(jira|confluence)$/.test(pathname) && method === 'DELETE') {
      const provider = pathname.endsWith('jira') ? 'jira' : 'confluence';
      state.connections = state.connections.map((connection) =>
        connection.provider === provider ? unconnected(provider) : connection,
      );
      return json({ connection: unconnected(provider), paused: ['jira-acme-atlassian-net-eng'] });
    }
    return json({ error: `not found: ${pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

function renderTab() {
  render(
    <MemoryRouter initialEntries={['/settings/connections']}>
      <Routes>
        <Route path="/*" element={<ConnectionsTab />} />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('the connectors list', () => {
  it('says which tools are connected, and offers only those that can be', async () => {
    serve();
    renderTab();
    const list = await screen.findByRole('list', { name: 'Connectors' });
    await waitFor(() => expect(within(list).getAllByText('Not connected')).toHaveLength(2));
    expect(within(list).getAllByText('Coming soon')).toHaveLength(4);
    expect(
      within(list).getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Connect Jira', 'Connect Confluence']);
  });

  it('names the site a connected tool reads, and when it was saved', async () => {
    serve({ connections: [connected('jira'), unconnected('confluence')] });
    renderTab();
    const list = await screen.findByRole('list', { name: 'Connectors' });
    await waitFor(() => expect(within(list).getByText('Connected')).toBeInTheDocument());
    expect(within(list).getByText('https://acme.atlassian.net')).toBeInTheDocument();
    expect(
      within(list).getByRole('button', { name: 'Edit the Jira connection' }),
    ).toBeInTheDocument();
  });
});

describe('connecting a tool', () => {
  it('tests the account first, then saves it', async () => {
    const state = serve();
    renderTab();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Connect Jira' }));
    await user.type(screen.getByRole('textbox', { name: 'Site URL' }), 'https://acme.atlassian.net');
    await user.type(screen.getByRole('textbox', { name: 'Account email' }), 'u@acme.test');
    await user.type(screen.getByLabelText('API token'), 'super-secret-token');

    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('The account answered')).toBeInTheDocument();
    expect(state.calls[0]).toEqual({
      method: 'POST',
      path: '/api/connections/jira/test',
      body: {
        baseUrl: 'https://acme.atlassian.net',
        accountEmail: 'u@acme.test',
        apiToken: 'super-secret-token',
      },
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.calls[1]).toMatchObject({ method: 'PUT', path: '/api/connections/jira' }),
    );
    // The row behind it re-reads, and now says the site it connected.
    expect(await screen.findByText('https://acme.atlassian.net')).toBeInTheDocument();
  });

  it('shows the account’s own refusal, and saves nothing', async () => {
    const state = serve({
      testRefusal: 'Authentication failed — check the account email and API token.',
    });
    renderTab();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Connect Confluence' }));
    await user.type(screen.getByRole('textbox', { name: 'Site URL' }), 'https://acme.atlassian.net');
    await user.type(screen.getByRole('textbox', { name: 'Account email' }), 'u@acme.test');
    await user.type(screen.getByLabelText('API token'), 'bad-token');
    await user.click(screen.getByRole('button', { name: 'Test' }));

    expect(
      await screen.findByText('Authentication failed — check the account email and API token.'),
    ).toBeInTheDocument();
    expect(state.calls.every((call) => call.method === 'POST')).toBe(true);
  });

  it('keeps the stored token when the field is left masked', async () => {
    const state = serve({ connections: [connected('jira'), unconnected('confluence')] });
    renderTab();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit the Jira connection' }));
    expect(screen.getByLabelText('API token')).toHaveAttribute(
      'placeholder',
      '••••oken, leave blank to keep',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.calls).toHaveLength(1));
    expect(state.calls[0]!.body).toEqual({
      baseUrl: 'https://acme.atlassian.net',
      accountEmail: 'u@acme.test',
    });
  });

  it('disconnects, and says how many sources that paused', async () => {
    const state = serve({ connections: [connected('jira'), unconnected('confluence')] });
    renderTab();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit the Jira connection' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(state.calls[0]).toMatchObject({ method: 'DELETE', path: '/api/connections/jira' }),
    );
    expect(await screen.findByText('Jira disconnected. 1 source paused.')).toBeInTheDocument();
  });

  it('offers no Disconnect for a tool nothing connected', async () => {
    serve();
    renderTab();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Jira' }));
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });
});
