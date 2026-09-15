/**
 * Settings › Repositories: where a repository is connected FROM.
 *
 * It is real for GitHub — the accounts are the App's installations
 * `/api/github/status` reports, and connecting one is a navigation to the App's
 * install page. GitLab is LISTED and says "Coming soon": no lock, no button,
 * nothing to click, because there is nothing behind it yet. The providers
 * beyond these two, and the Connections tab, are the enterprise bundle's and
 * are tested beside it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GithubConnectStatusResponse, GithubRepoSummary } from '@truecourse/shared';
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

const INSTALL_URL = 'https://github.com/apps/truecourse/installations/new?state=org_1';
const realFetch = window.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function linkedRepo(repoFullName: string, installationId: number): GithubRepoSummary {
  return {
    repoFullName,
    installationId,
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    notifyEmails: [],
    notifications: { gateFailure: true, conflicts: true, specRegen: true },
    slug: null,
    openConflicts: 0,
  };
}

function status(over: Partial<GithubConnectStatusResponse> = {}): GithubConnectStatusResponse {
  return {
    configured: true,
    installUrl: INSTALL_URL,
    installations: [{ installationId: 42, accountLogin: 'linkwarden', accountType: 'Organization' }],
    repos: [linkedRepo('linkwarden/linkwarden', 42), linkedRepo('linkwarden/docs', 42)],
    ...over,
  };
}

function serve(githubStatus: () => Response = () => json(status())) {
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/repos') return json([]);
    if (pathname === '/api/github/status') return githubStatus();
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

/** One provider row, by the provider's name. */
function providerRow(name: string): HTMLElement {
  const list = screen.getByRole('list', { name: 'Providers' });
  return within(list).getByText(name).closest('li')!;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('Settings › Repositories', () => {
  it('lists the two providers, GitHub with its installations and what each holds', async () => {
    serve();
    renderAt('/settings/repositories');

    const list = await screen.findByRole('list', { name: 'Providers' });
    // The provider rows themselves; an installation line is a row of its own list.
    expect(within(list).getAllByRole('listitem').filter((li) => li.parentElement === list)).toHaveLength(2);

    const github = providerRow('GitHub');
    expect(await within(github).findByText('Connected')).toBeInTheDocument();
    const installations = within(github).getByRole('list', { name: 'GitHub installations' });
    const rows = within(installations).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent('linkwarden · organization · 2 repositories linked');
    // Adding an account is the App's install page, nothing the client invents.
    expect(within(github).getByRole('link', { name: 'Add account' })).toHaveAttribute(
      'href',
      INSTALL_URL,
    );
  });

  it('asks for an install link that returns to where the user came from', async () => {
    serve(() => json(status({ installations: [], repos: [] })));
    renderAt('/settings/repositories?from=context-add');

    const github = providerRow('GitHub');
    await within(github).findByText('Not connected');
    const statusReads = vi.mocked(window.fetch).mock.calls
      .map(([input]) => String(input))
      .filter((href) => href.includes('/api/github/status'));
    expect(statusReads).toHaveLength(1);
    expect(statusReads[0]).toContain('from=context-add');
  });

  it('asks for a link that returns here when nobody sent the user', async () => {
    serve(() => json(status({ installations: [], repos: [] })));
    renderAt('/settings/repositories');

    const github = providerRow('GitHub');
    await within(github).findByText('Not connected');
    const statusReads = vi.mocked(window.fetch).mock.calls
      .map(([input]) => String(input))
      .filter((href) => href.includes('/api/github/status'));
    expect(statusReads[0]).toContain('from=settings');
  });

  it('offers Connect when the App is installed nowhere', async () => {
    serve(() => json(status({ installations: [], repos: [] })));
    renderAt('/settings/repositories');

    const github = providerRow('GitHub');
    expect(await within(github).findByText('Not connected')).toBeInTheDocument();
    expect(within(github).getByRole('link', { name: 'Connect' })).toHaveAttribute('href', INSTALL_URL);
    expect(within(github).queryByRole('list', { name: 'GitHub installations' })).toBeNull();
  });

  it('says why GitHub could not be read, in the server’s own words', async () => {
    const missing = 'GitHub is not configured on this server. Set GITHUB_APP_ID, then restart it.';
    serve(() => json({ error: missing }, 503));
    renderAt('/settings/repositories');

    const github = providerRow('GitHub');
    expect(await within(github).findByText(missing)).toBeInTheDocument();
    expect(within(github).queryByRole('link')).toBeNull();
  });

  it('lists GitLab as Coming soon, with nothing to click', async () => {
    serve();
    renderAt('/settings/repositories');
    await screen.findByRole('list', { name: 'Providers' });

    const row = providerRow('GitLab');
    expect(within(row).getByText('Coming soon')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).queryByRole('link')).toBeNull();
    // The word replaced the lock: no icon carries the meaning.
    expect(within(row).queryByText('Team plan')).toBeNull();
    // GitHub's accounts are GitHub's: a provider with nothing connected lists none.
    expect(within(row).queryByRole('list', { name: 'GitHub installations' })).toBeNull();
    expect(within(row).queryByText(/repositor(y|ies) linked/)).toBeNull();
  });

  it('has no Connections tab and no provider beyond the two', async () => {
    serve();
    renderAt('/settings/repositories');

    const sections = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(sections).queryByText('Connections')).toBeNull();
    expect(screen.queryByText('Azure DevOps')).toBeNull();
  });
});
