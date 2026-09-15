/**
 * What the enterprise bundle adds: the Connections tab, and Azure DevOps among
 * the repository providers.
 *
 * Both are registrations into the open shell — a settings tab and a repository
 * provider — so the whole app is rendered with this edition registered first,
 * and the assertions are on the open pages drawing what was registered.
 *
 * Nothing behind either one connects yet, so every connector row and the Azure
 * row say Coming soon and are inert: no lock, no button, nothing to click. The
 * provider still owns its hosts, so an Azure remote wears the Azure mark.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GithubConnectStatusResponse } from '@truecourse/shared';
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

const STATUS: GithubConnectStatusResponse = {
  configured: true,
  installUrl: 'https://github.com/apps/truecourse/installations/new?state=org_1',
  installations: [],
  repos: [],
};

function serve() {
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/repos') return json([]);
    if (pathname === '/api/github/status') return json(STATUS);
    if (pathname === '/api/llm/config') return json({ config: null, providers: ['anthropic'] });
    if (pathname === '/api/sessions/runs') return json({ runs: [] });
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/*" element={<DashboardApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  serve();
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('Settings › Connections', () => {
  it('is a section of Settings, after the ones the product has', async () => {
    renderAt('/settings');
    const sections = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(sections).getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Members',
      'Repositories',
      'Models',
      'Connections',
    ]);
  });

  it('lists the six tool connectors, every one of them Coming soon and inert', async () => {
    renderAt('/settings/connections');

    const list = await screen.findByRole('list', { name: 'Connectors' });
    const rows = within(list).getAllByRole('listitem');
    expect(
      rows.map(
        (row) =>
          within(row).getByText(/^(Jira|Confluence|Google Drive|OneDrive|Notion|Slack)$/).textContent,
      ),
    ).toEqual(['Jira', 'Confluence', 'Google Drive', 'OneDrive', 'Notion', 'Slack']);
    expect(within(list).getAllByText('Coming soon')).toHaveLength(6);
    expect(within(list).queryByRole('button')).toBeNull();
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
