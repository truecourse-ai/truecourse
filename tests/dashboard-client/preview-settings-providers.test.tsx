/**
 * Settings › Repositories: where a repository is connected FROM.
 *
 * It is real for GitHub — the accounts are the App's installations
 * `/api/github/status` reports, and connecting one is a navigation to GitHub's
 * authorize page. The page is also where every trip to GitHub that did not
 * attach lands: it says how the trip ended, and a `pick` landing offers the
 * accounts GitHub named for the person to choose from. GitLab is LISTED and
 * says "Coming soon": no lock, no button,
 * nothing to click, because there is nothing behind it yet. The providers
 * beyond these two, and the Connections tab, are the enterprise bundle's and
 * are tested beside it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import type {
  GithubConnectStatusResponse,
  GithubInstallationAccessResponse,
  GithubRepoSummary,
} from '@truecourse/shared';
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

const CONNECT_URL = 'https://github.com/login/oauth/authorize?client_id=Iv1.app&state=signed';
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
    connectUrl: CONNECT_URL,
    installations: [{ installationId: 42, accountLogin: 'linkwarden', accountType: 'Organization' }],
    repos: [linkedRepo('linkwarden/linkwarden', 42), linkedRepo('linkwarden/docs', 42)],
    ...over,
  };
}

/** The attach requests the page posted, body by body. */
let attached: unknown[] = [];
/** The installations the page asked to detach. */
let detached: number[] = [];
/** What GitHub says each installation may see; unanswered ids 404. */
let access: Record<number, GithubInstallationAccessResponse> = {};

function serve(githubStatus: (url: URL) => Response = () => json(status())) {
  attached = [];
  detached = [];
  access = { 42: { installed: true, repositorySelection: 'selected', repositories: 5 } };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const { pathname } = url;
    if (pathname === '/api/repos') return json([]);
    if (pathname === '/api/github/status') return githubStatus(url);
    if (pathname === '/api/github/installations/attach' && init?.method === 'POST') {
      attached.push(JSON.parse(String(init.body)));
      return json({ ok: true, attached: [] });
    }
    const seen = /^\/api\/github\/installations\/(\d+)\/access$/.exec(pathname);
    if (seen) {
      const answer = access[Number(seen[1])];
      return answer ? json(answer) : json({ error: 'GitHub could not be reached' }, 502);
    }
    const detach = /^\/api\/github\/installations\/(\d+)$/.exec(pathname);
    if (detach && init?.method === 'DELETE') {
      detached.push(Number(detach[1]));
      return json({ ok: true, disconnected: [] });
    }
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
      <Toaster />
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
    const accounts = within(github).getByRole('list', { name: 'GitHub accounts' });
    const rows = within(accounts).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    // What the account lets the App see is GitHub's answer, asked per
    // account; what Code has connected through it is Code's business.
    await within(rows[0]!).findByText(/5 repositories/);
    expect(rows[0]).toHaveTextContent('linkwarden · organization · 5 repositories');
    // Adding an account is ONE door, GitHub's authorize page; the server
    // sends the person on to install from there when there is nothing to offer.
    expect(within(github).getByRole('link', { name: 'Add account' })).toHaveAttribute(
      'href',
      CONNECT_URL,
    );
    expect(within(github).queryByRole('link', { name: /Install on another/ })).toBeNull();
    // Which repositories the App sees is changed on GitHub, on the
    // installation's own settings page: an organization's, under the org.
    expect(within(rows[0]!).getByRole('link', { name: 'Manage linkwarden on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/organizations/linkwarden/settings/installations/42',
    );
    // Remove is the line's icon button, named for the reader.
    expect(within(rows[0]!).getByRole('button', { name: 'Remove linkwarden' })).toBeEnabled();
  });

  it("links a user account's installation to the user's own settings page, and says what it lets the App see", async () => {
    serve(() =>
      json(
        status({
          installations: [
            { installationId: 7, accountLogin: 'spiderhands', accountType: 'User' },
            { installationId: 8, accountLogin: 'octo', accountType: 'User' },
            { installationId: 9, accountLogin: 'nine', accountType: 'User' },
          ],
          repos: [],
        }),
      ),
    );
    access = {
      7: { installed: true, repositorySelection: 'all', repositories: 12 },
      8: { installed: true, repositorySelection: 'selected', repositories: 0 },
    };
    renderAt('/settings/repositories');
    const github = providerRow('GitHub');
    expect(await within(github).findByRole('link', { name: 'Manage spiderhands on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/settings/installations/7',
    );
    const accounts = within(github).getByRole('list', { name: 'GitHub accounts' });
    const rows = within(accounts).getAllByRole('listitem');
    // Every repository of the account, now and later; a selection of none;
    // and an account GitHub could not be asked about.
    await within(rows[0]!).findByText(/all repositories/);
    await within(rows[1]!).findByText(/no repositories/);
    await within(rows[2]!).findByText(/access unknown/);
  });

  it('asks before removing an account, in its own dialog, naming what leaves with it', async () => {
    const user = userEvent.setup();
    serve();
    renderAt('/settings/repositories');
    const github = providerRow('GitHub');
    await user.click(await within(github).findByRole('button', { name: 'Remove linkwarden' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Remove linkwarden from this workspace?');
    expect(dialog).toHaveTextContent('2 repositories connected through it will be disconnected');
    expect(dialog).toHaveTextContent('linkwarden/linkwarden');
    expect(dialog).toHaveTextContent('linkwarden/docs');
    // Cancel asks nothing of the server.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(detached).toEqual([]);

    await user.click(within(github).getByRole('button', { name: 'Remove linkwarden' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(detached).toEqual([42]));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
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
    expect(within(github).getByRole('link', { name: 'Connect' })).toHaveAttribute('href', CONNECT_URL);
    expect(within(github).queryByRole('list', { name: 'GitHub accounts' })).toBeNull();
  });

  it('toasts a return from an installation’s settings page on GitHub, once, and leaves the row alone', async () => {
    serve();
    renderAt('/settings/repositories?github=updated&from=settings');

    expect(await screen.findByText('Repository access updated on GitHub')).toBeInTheDocument();
    // An event on the way back, not a state of the page: nothing is drawn in the row.
    const github = providerRow('GitHub');
    await within(github).findByText('Connected');
    expect(within(github).queryByText(/updated on GitHub/)).toBeNull();
    expect(screen.getAllByText('Repository access updated on GitHub')).toHaveLength(1);
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
    expect(within(row).queryByRole('list', { name: 'GitHub accounts' })).toBeNull();
    expect(within(row).queryByText(/repositor(y|ies) linked/)).toBeNull();
  });

  it('toasts how a trip to GitHub ended, as a refusal when it was one, wherever it started', async () => {
    serve(() => json(status({ installations: [], repos: [] })));
    renderAt('/settings/repositories?github=expired&from=code-connect');

    expect(await screen.findByText('Connecting to GitHub did not finish')).toBeInTheDocument();
    expect(
      screen.getByText('The trip took too long, or came back to another session. Nothing was added. Try again.'),
    ).toBeInTheDocument();
    // The retry from here goes back where the trip started.
    const statusReads = vi.mocked(window.fetch).mock.calls
      .map(([input]) => String(input))
      .filter((href) => href.includes('/api/github/status'));
    expect(statusReads[0]).toContain('from=code-connect');
  });

  it('offers the accounts a pick landing names, attaches the ticked ones, and carries on where the trip started', async () => {
    const user = userEvent.setup();
    serve((url) =>
      json(
        status({
          repos: [],
          ...(url.searchParams.get('offer') === 'signed-offer'
            ? {
                offered: [
                  { installationId: 100, accountLogin: 'acme', accountType: 'Organization' },
                  { installationId: 200, accountLogin: 'octo', accountType: 'User' },
                ],
              }
            : {}),
        }),
      ),
    );
    renderAt('/settings/repositories?github=pick&offer=signed-offer&from=code-connect');

    // The pick is a dialog over the page: every offered account ticked, one
    // button that says how many it connects. The row underneath is untouched.
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Connect GitHub accounts');
    const offered = within(dialog).getByRole('list', { name: 'Offered GitHub accounts' });
    const boxes = within(offered).getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes.every((box) => (box as HTMLInputElement).checked)).toBe(true);
    expect(within(dialog).getByRole('button', { name: 'Connect 2 accounts' })).toBeEnabled();
    // The only checkboxes on the page are the dialog's: the row draws none.
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);

    // The person unticks what is not theirs to add.
    await user.click(within(offered).getByLabelText(/octo/));
    await user.click(within(dialog).getByRole('button', { name: 'Connect 1 account' }));

    await waitFor(() => expect(attached).toEqual([{ offer: 'signed-offer', installationIds: [100] }]));
    // On to the Code connect dialog, the pick made.
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Connect a repository'));
  });

  it('cancels the pick with nothing attached, and drops it from the address', async () => {
    const user = userEvent.setup();
    serve((url) =>
      json(
        status({
          repos: [],
          ...(url.searchParams.get('offer') === 'signed-offer'
            ? {
                offered: [
                  { installationId: 100, accountLogin: 'acme', accountType: 'Organization' },
                  { installationId: 200, accountLogin: 'octo', accountType: 'User' },
                ],
              }
            : {}),
        }),
      ),
    );
    renderAt('/settings/repositories?github=pick&offer=signed-offer&from=settings');

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(attached).toEqual([]);
    // Still on Settings, the held account still there.
    expect(await within(providerRow('GitHub')).findByText('linkwarden')).toBeInTheDocument();
  });

  it('toasts when the offer a pick landing carries is no longer honoured', async () => {
    serve(() => json(status({ installations: [], repos: [] })));
    renderAt('/settings/repositories?github=pick&offer=stale&from=settings');

    expect(await screen.findByText('That offer expired')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says when GitHub no longer knows an account', async () => {
    serve(() =>
      json(
        status({
          installations: [{ installationId: 7, accountLogin: 'spiderhands', accountType: 'User' }],
          repos: [],
        }),
      ),
    );
    access = { 7: { installed: false } };
    renderAt('/settings/repositories');
    const accounts = await within(providerRow('GitHub')).findByRole('list', { name: 'GitHub accounts' });
    expect(await within(accounts).findByText(/no longer installed/)).toBeInTheDocument();
  });

  it('has no Connections tab and no provider beyond the two', async () => {
    serve();
    renderAt('/settings/repositories');

    const sections = await screen.findByRole('navigation', { name: 'Settings sections' });
    expect(within(sections).queryByText('Connections')).toBeNull();
    expect(screen.queryByText('Azure DevOps')).toBeNull();
  });
});
