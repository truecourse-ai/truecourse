/**
 * Settings › Repositories and Settings › Connections: where a provider and a
 * tool are connected FROM.
 *
 * Repositories is real for GitHub — the accounts are the App's installations
 * `/api/github/status` reports, and connecting one is a navigation to the App's
 * install page. GitLab and Azure DevOps, and every tool connector on
 * Connections, are LISTED and say "Coming soon": no lock, no button, nothing to
 * click, because there is nothing behind them yet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { GithubConnectStatusResponse, GithubRepoSummary } from '@truecourse/shared';
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
        <Route path="/preview/*" element={<PreviewApp />} />
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
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('Settings › Repositories', () => {
  it('lists the three providers, GitHub with its installations and what each holds', async () => {
    serve();
    renderAt('/preview/settings/repositories');

    const list = await screen.findByRole('list', { name: 'Providers' });
    // The provider rows themselves; an installation line is a row of its own list.
    expect(within(list).getAllByRole('listitem').filter((li) => li.parentElement === list)).toHaveLength(3);

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

  it('offers Connect when the App is installed nowhere', async () => {
    serve(() => json(status({ installations: [], repos: [] })));
    renderAt('/preview/settings/repositories');

    const github = providerRow('GitHub');
    expect(await within(github).findByText('Not connected')).toBeInTheDocument();
    expect(within(github).getByRole('link', { name: 'Connect' })).toHaveAttribute('href', INSTALL_URL);
    expect(within(github).queryByRole('list', { name: 'GitHub installations' })).toBeNull();
  });

  it('says why GitHub could not be read, in the server’s own words', async () => {
    const missing = 'GitHub is not configured on this server. Set GITHUB_APP_ID, then restart it.';
    serve(() => json({ error: missing }, 503));
    renderAt('/preview/settings/repositories');

    const github = providerRow('GitHub');
    expect(await within(github).findByText(missing)).toBeInTheDocument();
    expect(within(github).queryByRole('link')).toBeNull();
  });

  it('lists GitLab and Azure DevOps as Coming soon, with nothing to click', async () => {
    serve();
    renderAt('/preview/settings/repositories');
    await screen.findByRole('list', { name: 'Providers' });

    for (const name of ['GitLab', 'Azure DevOps']) {
      const row = providerRow(name);
      expect(within(row).getByText('Coming soon')).toBeInTheDocument();
      expect(within(row).queryByRole('button')).toBeNull();
      expect(within(row).queryByRole('link')).toBeNull();
      // The word replaced the lock: no icon carries the meaning.
      expect(within(row).queryByText('Team plan')).toBeNull();
      // GitHub's accounts are GitHub's: a provider with nothing connected lists none.
      expect(within(row).queryByRole('list', { name: 'GitHub installations' })).toBeNull();
      expect(within(row).queryByText(/repositor(y|ies) linked/)).toBeNull();
    }
  });
});

describe('Settings › Connections', () => {
  it('lists the six tool connectors, every one of them Coming soon and inert', async () => {
    serve();
    renderAt('/preview/settings/connections');

    const list = await screen.findByRole('list', { name: 'Connectors' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => within(row).getByText(/^(Jira|Confluence|Google Drive|OneDrive|Notion|Slack)$/).textContent)).toEqual([
      'Jira',
      'Confluence',
      'Google Drive',
      'OneDrive',
      'Notion',
      'Slack',
    ]);
    expect(within(list).getAllByText('Coming soon')).toHaveLength(6);
    expect(within(list).queryByRole('button')).toBeNull();
    expect(within(list).queryByRole('link')).toBeNull();
  });
});
