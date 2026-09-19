/**
 * What the enterprise bundle adds: the Connections tab, and Azure DevOps among
 * the repository providers.
 *
 * Both are registrations into the open shell — a settings tab and a repository
 * provider — so the whole app is rendered with this edition registered first,
 * and the assertions are on the open pages drawing what was registered.
 *
 * Registering the tab is not what puts it on the page: the workspace has to
 * HOLD the Connections grant, which the session answers. A workspace that does
 * not is a Settings page without that section at all, which is the last of the
 * three places the grant is enforced.
 *
 * One connector connects — Atlassian, the single account whose token reads
 * both Jira and Confluence, a row that opens its account form; the other four
 * and the Azure row say Coming soon and are inert: no lock, no button, nothing
 * to click. The provider still owns its hosts, so an Azure remote wears the
 * Azure mark.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  CONTEXT_CONNECTION_KINDS,
  CONTEXT_CONNECTION_PROVIDERS,
  type GithubConnectStatusResponse,
} from '@truecourse/shared';
import type { EnterpriseFeature } from '@truecourse/shared';
import { AuthProvider } from '@/auth/AuthContext';
import DashboardApp from '@/dashboard/DashboardApp';
import { registerEditionFeatures } from '../../ee/packages/client/src/edition';

registerEditionFeatures();

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

const realFetch = window.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A workspace that has connected no account. */
const CONNECTIONS = CONTEXT_CONNECTION_PROVIDERS.map((provider) => ({
  provider,
  kinds: [...CONTEXT_CONNECTION_KINDS[provider]],
  connected: false,
  baseUrl: '',
  accountEmail: '',
  tokenMask: null,
  updatedAt: null,
}));

const STATUS: GithubConnectStatusResponse = {
  configured: true,
  installations: [],
  repos: [],
};

const USER = {
  id: 'user_me',
  email: 'dana@acme.dev',
  firstName: 'Dana',
  organizationId: 'org_a',
  organizationName: 'Acme',
};

/** What the session says this workspace may use. */
let entitlements: EnterpriseFeature[];

function serve() {
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/auth/me') {
      return json({
        user: USER,
        edition: entitlements.length > 0 ? 'enterprise' : 'community',
        entitlements,
      });
    }
    if (pathname === '/api/repos') return json([]);
    if (pathname === '/api/github/status') return json(STATUS);
    if (pathname === '/api/llm/config') return json({ config: null, providers: ['anthropic'] });
    if (pathname === '/api/sessions/runs') return json({ runs: [] });
    if (pathname === '/api/connections') return json({ connections: CONNECTIONS });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/*" element={<DashboardApp />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  entitlements = ['connections'];
  serve();
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('Settings › Connections', () => {
  it('is a section of Settings, after the ones the product has', async () => {
    renderAt('/settings');
    const sections = await screen.findByRole('navigation', { name: 'Settings sections' });
    await waitFor(() =>
      expect(within(sections).getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Members',
        'Repositories',
        'Models',
        'Usage',
        'Credits',
        'Connections',
      ]),
    );
  });

  it('is not a section at all for a workspace that was not granted it', async () => {
    entitlements = [];
    renderAt('/settings');
    const sections = await screen.findByRole('navigation', { name: 'Settings sections' });
    await waitFor(() =>
      expect(within(sections).getAllByRole('link').map((link) => link.textContent)).toEqual([
        'Members',
        'Repositories',
        'Models',
        'Usage',
        'Credits',
      ]),
    );
  });

  // Its address is not a way in either: a section this workspace does not have
  // lands on the first one it does, and nothing asks the server for a
  // connection it may not read.
  it('does not open at its own address for a workspace without the grant', async () => {
    entitlements = [];
    renderAt('/settings/connections');
    expect(await screen.findByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Connectors' })).toBeNull());
    const reads = (window.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(
      (call) => String(call[0]).includes('/api/connections'),
    );
    expect(reads).toEqual([]);
  });

  it('lists the one account and the four tools that cannot connect yet', async () => {
    renderAt('/settings/connections');

    const list = await screen.findByRole('list', { name: 'Connectors' });
    const rows = within(list).getAllByRole('listitem');
    expect(
      rows.map(
        (row) =>
          within(row).getByText(/^(Atlassian|Google Drive|OneDrive|Notion|Slack)$/).textContent,
      ),
    ).toEqual(['Atlassian', 'Google Drive', 'OneDrive', 'Notion', 'Slack']);
    // The four with nothing behind them stay listed and inert.
    expect(within(list).getAllByText('Coming soon')).toHaveLength(4);
    expect(within(list).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['Connect Atlassian']);
    expect(within(list).queryByRole('link')).toBeNull();
  });
});

describe('Settings › Repositories, with this edition', () => {
  it('lists Azure DevOps beside the two the open edition has, Coming soon and inert', async () => {
    renderAt('/settings/repositories');

    const list = await screen.findByRole('list', { name: 'Providers' });
    const rows = within(list).getAllByRole('listitem').filter((li) => li.parentElement === list);
    expect(rows).toHaveLength(3);

    const azure = within(list).getByText('Azure DevOps').closest('li')!;
    expect(within(azure).getByText('Coming soon')).toBeInTheDocument();
    expect(within(azure).queryByRole('button')).toBeNull();
    expect(within(azure).queryByRole('link')).toBeNull();
  });
});
