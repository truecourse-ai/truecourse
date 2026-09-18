/**
 * Settings › Connections, for real: the one account that connects.
 *
 * An Atlassian site is ONE account, so it is ONE row wearing Atlassian's mark.
 * The row opens the account form; Test makes one read per product and says
 * what each answered; Save stores it and the row then names
 * the site it reads. Removing says how many sources it paused. The other four
 * tools stay listed and inert.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import type {
  ContextConnectionTestResponse,
  ContextConnectionView,
} from '@truecourse/shared';
import { ConnectionsTab } from '../../ee/packages/client/src/connections/ConnectionsTab';

const realFetch = window.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const unconnected: ContextConnectionView = {
  provider: 'atlassian',
  kinds: ['jira', 'confluence'],
  connected: false,
  baseUrl: '',
  accountEmail: '',
  tokenMask: null,
  updatedAt: null,
};

const connected: ContextConnectionView = {
  provider: 'atlassian',
  kinds: ['jira', 'confluence'],
  connected: true,
  baseUrl: 'https://acme.atlassian.net',
  accountEmail: 'u@acme.test',
  tokenMask: '••••oken',
  updatedAt: '2026-09-16T10:00:00.000Z',
};

interface World {
  connections: ContextConnectionView[];
  /** Every write the page made: method, path and body. */
  calls: { method: string; path: string; body: unknown }[];
  /** What the next Test answers, per product. */
  testAnswer: ContextConnectionTestResponse;
}

function serve(over: Partial<World> = {}): World {
  const state: World = {
    connections: [unconnected],
    calls: [],
    testAnswer: { ok: true, products: { jira: { ok: true }, confluence: { ok: true } } },
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
    if (pathname === '/api/connections/atlassian/test') return json(state.testAnswer);
    if (pathname === '/api/connections/atlassian' && method === 'PUT') {
      state.connections = [connected];
      return json({ connection: connected });
    }
    if (pathname === '/api/connections/atlassian' && method === 'DELETE') {
      state.connections = [unconnected];
      return json({ connection: unconnected, paused: ['jira-acme-atlassian-net-eng'] });
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
  it('is one Atlassian row wearing one mark, above the four that cannot connect yet', async () => {
    serve();
    renderTab();
    const list = await screen.findByRole('list', { name: 'Connectors' });
    await waitFor(() => expect(within(list).getByText('Not connected')).toBeInTheDocument());
    expect(within(list).getByText('Atlassian')).toBeInTheDocument();
    expect(within(list).queryByText('Jira')).toBeNull();
    expect(within(list).getAllByText('Coming soon')).toHaveLength(4);
    expect(
      within(list).getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Connect Atlassian']);

    // One account, one mark: Atlassian's, not the two products'.
    const atlassian = within(list).getAllByRole('listitem')[0]!;
    expect([...atlassian.querySelectorAll('img')].map((img) => img.dataset.tool)).toEqual(['atlassian']);
  });

  it('names the site the account reads, and when it was saved', async () => {
    serve({ connections: [connected] });
    renderTab();
    const list = await screen.findByRole('list', { name: 'Connectors' });
    await waitFor(() => expect(within(list).getByText('Connected')).toBeInTheDocument());
    expect(within(list).getByText('https://acme.atlassian.net')).toBeInTheDocument();
    expect(
      within(list).getByRole('button', { name: 'Edit the Atlassian connection' }),
    ).toBeInTheDocument();
  });
});

describe('connecting the account', () => {
  it('tests every product first, then saves it', async () => {
    const state = serve();
    renderTab();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Connect Atlassian' }));
    expect(
      screen.getByText(
        'The account this workspace reads Jira and Confluence with. What it reads is added in Context.',
      ),
    ).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Site URL' }), 'https://acme.atlassian.net');
    await user.type(screen.getByRole('textbox', { name: 'Account email' }), 'u@acme.test');
    await user.type(screen.getByLabelText('API token'), 'super-secret-token');

    await user.click(screen.getByRole('button', { name: 'Test' }));
    expect(await screen.findByText('Jira answered.')).toBeInTheDocument();
    expect(screen.getByText('Confluence answered.')).toBeInTheDocument();
    expect(state.calls[0]).toEqual({
      method: 'POST',
      path: '/api/connections/atlassian/test',
      body: {
        baseUrl: 'https://acme.atlassian.net',
        accountEmail: 'u@acme.test',
        apiToken: 'super-secret-token',
      },
    });

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.calls[1]).toMatchObject({ method: 'PUT', path: '/api/connections/atlassian' }),
    );
    // The row behind it re-reads, and now says the site it connected.
    expect(await screen.findByText('https://acme.atlassian.net')).toBeInTheDocument();
  });

  it('says which product refused, in its own words, while the other answered', async () => {
    serve({
      testAnswer: {
        ok: true,
        products: {
          jira: { ok: true },
          confluence: { ok: false, error: 'This site has no Confluence.' },
        },
      },
    });
    renderTab();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Connect Atlassian' }));
    await user.type(screen.getByRole('textbox', { name: 'Site URL' }), 'https://acme.atlassian.net');
    await user.type(screen.getByRole('textbox', { name: 'Account email' }), 'u@acme.test');
    await user.type(screen.getByLabelText('API token'), 'super-secret-token');
    await user.click(screen.getByRole('button', { name: 'Test' }));

    expect(await screen.findByText('Jira answered.')).toBeInTheDocument();
    expect(
      screen.getByText('Confluence: This site has no Confluence.'),
    ).toBeInTheDocument();
  });

  it('shows every product’s refusal when the account itself is wrong', async () => {
    const refusal = 'Authentication failed — check the account email and API token.';
    const state = serve({
      testAnswer: {
        ok: false,
        products: { jira: { ok: false, error: refusal }, confluence: { ok: false, error: refusal } },
      },
    });
    renderTab();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Connect Atlassian' }));
    await user.type(screen.getByRole('textbox', { name: 'Site URL' }), 'https://acme.atlassian.net');
    await user.type(screen.getByRole('textbox', { name: 'Account email' }), 'u@acme.test');
    await user.type(screen.getByLabelText('API token'), 'bad-token');
    await user.click(screen.getByRole('button', { name: 'Test' }));

    expect(await screen.findByText(`Jira: ${refusal}`)).toBeInTheDocument();
    expect(screen.getByText(`Confluence: ${refusal}`)).toBeInTheDocument();
    expect(state.calls.every((call) => call.method === 'POST')).toBe(true);
  });

  it('keeps the stored token when the field is left masked', async () => {
    const state = serve({ connections: [connected] });
    renderTab();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit the Atlassian connection' }));
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
    const state = serve({ connections: [connected] });
    renderTab();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Edit the Atlassian connection' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    await waitFor(() =>
      expect(state.calls[0]).toMatchObject({
        method: 'DELETE',
        path: '/api/connections/atlassian',
      }),
    );
    expect(await screen.findByText('Atlassian disconnected. 1 source paused.')).toBeInTheDocument();
  });

  it('offers no Disconnect for an account nothing connected', async () => {
    serve();
    renderTab();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Connect Atlassian' }));
    expect(screen.queryByRole('button', { name: 'Disconnect' })).toBeNull();
  });
});
