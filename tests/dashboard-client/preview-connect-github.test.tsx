/**
 * Connecting a repository through the GitHub App, from the one-product shell.
 *
 * Everything else in the preview is fake, so this file is about the seam: the
 * dialog reads the real `/api/github/status`, lists what an installation can
 * see, posts one `/api/github/repos/link` per picked repository, and the shell
 * re-reads the real `/api/repos`. A repository that came back that way renders
 * on Home with none of the fixture coverage the mock repositories have.
 *
 * The seam widened with the Activity surface: a repository that is real gets
 * the REAL sessions view (`/api/repos/<id>/sessions/*`, live-tailed) on its
 * Activity tab, while the fixtures keep the mock — the last describe here.
 *
 * `window.fetch` is replaced wholesale rather than routed around the preview's
 * own shim: the shim is installed once when the preview chunk loads (it never
 * uninstalls), and replacing the global is what a caller's stub does anyway.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type {
  GithubConnectStatusResponse,
  GithubInstallableRepo,
  GithubRepoSummary,
} from '@truecourse/shared';
import PreviewApp from '@/preview/PreviewApp';
import { parseRemote, toPreviewRepo } from '@/preview/data/real-repos';

// The real sessions view opens a socket for its live tail; jsdom has no server
// to reach, and the tail is not what this file is about.
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

interface RegistryEntry {
  id: string;
  name: string;
  path: string;
  remoteUrl?: string | null;
  defaultBranch?: string;
}

interface LinkBody {
  repoFullName?: string;
  installationId?: number;
  defaultBranch?: string;
}

const INSTALL_URL = 'https://github.com/apps/truecourse/installations/new?state=org_1';

const realFetch = window.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A linked repo as `/api/github/status` reports it. */
function linkedRepo(repoFullName: string): GithubRepoSummary {
  return {
    repoFullName,
    installationId: 42,
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    notifyEmails: [],
    notifications: { gateFailure: true, conflicts: true, specRegen: true },
    slug: null,
    openConflicts: 0,
  };
}

function status(partial: Partial<GithubConnectStatusResponse> = {}): GithubConnectStatusResponse {
  return {
    configured: true,
    installUrl: INSTALL_URL,
    installations: [{ installationId: 42, accountLogin: 'linkwarden', accountType: 'Organization' }],
    repos: [],
    ...partial,
  };
}

interface Backend {
  registry?: RegistryEntry[];
  /** `/api/github/status` as a Response, so a test can answer 503. */
  status?: () => Response;
  /** What each installation can see. */
  installationRepos?: Record<number, GithubInstallableRepo[]>;
  /** Async so a test can hold a link open and watch the button say so. */
  link?: (body: LinkBody) => Response | Promise<Response>;
}

/** A server answering the registry and the GitHub connect routes; everything else 404s. */
function serve(backend: Backend = {}) {
  const posted: LinkBody[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (pathname === '/api/repos' && method === 'GET') return json(backend.registry ?? []);
    if (pathname === '/api/github/status') return backend.status?.() ?? json(status());
    const listing = /^\/api\/github\/installations\/(\d+)\/repos$/.exec(pathname);
    if (listing) {
      return json({ repos: backend.installationRepos?.[Number(listing[1])] ?? [] });
    }
    if (pathname === '/api/github/repos/link' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as LinkBody;
      posted.push(body);
      return (await backend.link?.(body)) ?? json({ ok: true }, 201);
    }
    // Every per-repo guard route: the preview's own shim would answer these from
    // the fixtures, and a repository with no fixtures has nothing to answer with.
    return json({ error: 'not found' }, 404);
  });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  return { fetchMock, posted };
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

/** Open the dialog on GitHub's repositories: pick the provider, wait for its list. */
async function openGithubRepos() {
  renderAt('/preview?connect=1');
  const dialog = await screen.findByRole('dialog');
  const row = (await within(dialog).findByText('GitHub')).closest('li')!;
  await userEvent.click(within(row).getByRole('button', { name: 'Select' }));
  return dialog;
}

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('a remote URL as a preview repository', () => {
  it('reads owner/repo and the provider off the host', () => {
    expect(parseRemote('https://github.com/acme/orders-api.git')).toEqual({
      fullName: 'acme/orders-api',
      provider: 'github',
    });
    expect(parseRemote('https://gitlab.com/group/sub/thing')).toEqual({
      fullName: 'sub/thing',
      provider: 'gitlab',
    });
    expect(parseRemote('https://dev.azure.com/acme/billing')).toEqual({
      fullName: 'acme/billing',
      provider: 'azure',
    });
    // No fourth icon in the preview: an unfamiliar host reads as github.
    expect(parseRemote('https://git.sr.ht/~user/thing').provider).toBe('github');
  });

  it('maps a registry entry to a repository with no history behind it', () => {
    const repo = toPreviewRepo({
      id: 'orders-api',
      name: 'acme/orders-api',
      path: '/clones/acme__orders-api',
      remoteUrl: 'https://github.com/acme/orders-api',
      defaultBranch: 'trunk',
    });
    expect(repo).toMatchObject({
      id: 'orders-api',
      fullName: 'acme/orders-api',
      provider: 'github',
      visibility: 'public',
      defaultBranch: 'trunk',
      policy: 'advisory',
      baselineSha: 'no baseline yet',
      onboarding: false,
      real: true,
    });
    expect(repo.lastCheck).toEqual({
      conclusion: 'neutral',
      word: 'Neutral',
      summary: 'Connected, nothing has run yet',
      at: 'just now',
    });
  });
});

describe('connecting a repository through the GitHub App', () => {
  it('lists a connected repository on Home with no coverage yet', async () => {
    serve({
      registry: [
        // A path-registered repo of the developer's own: never the product's business.
        { id: 'local-thing', name: 'local-thing', path: '/home/dev/local-thing' },
        {
          id: 'linkwarden',
          name: 'linkwarden/linkwarden',
          path: '/clones/linkwarden__linkwarden',
          remoteUrl: 'https://github.com/linkwarden/linkwarden',
        },
      ],
    });
    renderAt('/preview');
    const name = await screen.findByText('linkwarden/linkwarden');
    expect(screen.queryByText('local-thing')).toBeNull();
    // No fixtures are keyed by its slug, so its requirements cell is the empty
    // one and its proven share is blank.
    const row = name.closest('tr')!;
    expect(within(row).getByText('no corpus yet')).toBeInTheDocument();
    expect(within(row).getByText('Neutral')).toBeInTheDocument();
  });

  it('links each picked repository with its installation and default branch, then closes', async () => {
    const registry: RegistryEntry[] = [];
    const { posted } = serve({
      registry,
      installationRepos: {
        42: [
          { fullName: 'linkwarden/linkwarden', defaultBranch: 'main', private: false },
          { fullName: 'linkwarden/docs', defaultBranch: 'trunk', private: true },
        ],
      },
      link: (body) => {
        registry.push({
          id: String(body.repoFullName).split('/')[1]!,
          name: String(body.repoFullName),
          path: `/clones/${String(body.repoFullName).replace('/', '__')}`,
          remoteUrl: `https://github.com/${String(body.repoFullName)}`,
          defaultBranch: body.defaultBranch,
        });
        return json({ ok: true }, 201);
      },
    });

    const dialog = await openGithubRepos();
    await userEvent.click(await screen.findByLabelText('linkwarden/linkwarden'));
    await userEvent.click(screen.getByLabelText('linkwarden/docs'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect and start onboarding' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted).toEqual([
      { repoFullName: 'linkwarden/linkwarden', installationId: 42, defaultBranch: 'main' },
      { repoFullName: 'linkwarden/docs', installationId: 42, defaultBranch: 'trunk' },
    ]);
    expect(await screen.findByText('linkwarden/linkwarden')).toBeInTheDocument();
  });

  it('says which clone it is waiting on while the server clones', async () => {
    let release = () => {};
    const cloning = new Promise<void>((resolve) => {
      release = resolve;
    });
    serve({
      installationRepos: { 42: [{ fullName: 'linkwarden/linkwarden', defaultBranch: 'main', private: false }] },
      link: async () => {
        await cloning;
        return json({ ok: true }, 201);
      },
    });

    const dialog = await openGithubRepos();
    await userEvent.click(await screen.findByLabelText('linkwarden/linkwarden'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect and start onboarding' }));

    expect(await within(dialog).findByRole('button', { name: 'Cloning 1 of 1' })).toBeDisabled();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('names the account each installation belongs to', async () => {
    serve({ installationRepos: { 42: [] } });

    renderAt('/preview?connect=1');
    const dialog = await screen.findByRole('dialog');
    const row = (await within(dialog).findByText('GitHub')).closest('li')!;
    // The provider row says whose GitHub this is before anything is picked.
    expect(await within(row).findByText('linkwarden')).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Select' }));
    expect(
      await within(dialog).findByRole('button', { name: 'linkwarden' }),
    ).toBeInTheDocument();
  });

  it('falls back to the installation id when the account has no name', async () => {
    serve({
      status: () =>
        json(status({ installations: [{ installationId: 42, accountLogin: '', accountType: '' }] })),
      installationRepos: { 42: [] },
    });

    renderAt('/preview?connect=1');
    const dialog = await screen.findByRole('dialog');
    const row = (await within(dialog).findByText('GitHub')).closest('li')!;
    expect(await within(row).findByText('#42')).toBeInTheDocument();
  });

  it('says what the server is missing when the App is not configured', async () => {
    const missing =
      'GitHub is not configured on this server. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, ' +
      'GITHUB_APP_WEBHOOK_SECRET and GITHUB_APP_SLUG, then restart it.';
    serve({ status: () => json({ error: missing }, 503) });

    renderAt('/preview?connect=1');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(missing)).toBeInTheDocument();
    // Nothing to click: the fix is on the server, not in this dialog.
    const row = within(dialog).getByText('GitHub').closest('li')!;
    expect(within(row).queryByRole('button')).toBeNull();
    expect(within(row).queryByRole('link')).toBeNull();
  });

  it('sends the user to GitHub when the App is installed nowhere', async () => {
    serve({ status: () => json(status({ installations: [] })) });

    renderAt('/preview?connect=1');
    const dialog = await screen.findByRole('dialog');
    const row = within(dialog).getByText('GitHub').closest('li')!;
    const install = await within(row).findByRole('link', { name: 'Install' });
    expect(install).toHaveAttribute('href', INSTALL_URL);
    expect(within(row).queryByRole('button')).toBeNull();
  });

  it('marks an already-connected repository and refuses to connect it twice', async () => {
    serve({
      status: () => json(status({ repos: [linkedRepo('linkwarden/linkwarden')] })),
      installationRepos: {
        42: [
          { fullName: 'linkwarden/linkwarden', defaultBranch: 'main', private: false },
          { fullName: 'linkwarden/docs', defaultBranch: 'trunk', private: true },
        ],
      },
    });

    await openGithubRepos();
    expect(await screen.findByLabelText('linkwarden/linkwarden')).toBeDisabled();
    expect(screen.getByText('connected')).toBeInTheDocument();
    expect(screen.getByLabelText('linkwarden/docs')).toBeEnabled();
  });

  it('keeps the dialog open and names the repository the server refused', async () => {
    const { posted } = serve({
      installationRepos: {
        42: [
          { fullName: 'linkwarden/linkwarden', defaultBranch: 'main', private: false },
          { fullName: 'linkwarden/docs', defaultBranch: 'trunk', private: true },
        ],
      },
      // The first lands, the second is refused: one failure must not cost the batch.
      link: (body) =>
        body.repoFullName === 'linkwarden/docs'
          ? json({ error: 'repository already connected to another workspace' }, 409)
          : json({ ok: true }, 201),
    });

    const dialog = await openGithubRepos();
    await userEvent.click(await screen.findByLabelText('linkwarden/linkwarden'));
    await userEvent.click(screen.getByLabelText('linkwarden/docs'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect and start onboarding' }));

    expect(
      await within(dialog).findByText('repository already connected to another workspace'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Connect and start onboarding' })).toBeEnabled();
    // Retrying re-clones only what failed: the one that landed is out of the selection.
    expect(within(dialog).queryByText('linkwarden/linkwarden')).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect and start onboarding' }));
    await waitFor(() => expect(posted).toHaveLength(3));
    expect(posted.map((p) => p.repoFullName)).toEqual([
      'linkwarden/linkwarden',
      'linkwarden/docs',
      'linkwarden/docs',
    ]);
  });

  it('is a mock with no server behind it: the fixtures render and nothing throws', async () => {
    window.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof window.fetch;
    renderAt('/preview');
    expect(await screen.findByText('acme/orders-api')).toBeInTheDocument();
  });
});

describe('Activity is real on a connected repository', () => {
  const CONNECTED: RegistryEntry = {
    id: 'linkwarden',
    name: 'linkwarden/linkwarden',
    path: '/clones/linkwarden__linkwarden',
    remoteUrl: 'https://github.com/linkwarden/linkwarden',
  };

  it('reads the real sessions store and shows its empty state', async () => {
    const { fetchMock } = serve({ registry: [CONNECTED] });
    // The registry read is served above; the sessions route is this test's point.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(href, window.location.origin);
      if (pathname === '/api/repos') return json([CONNECTED]);
      if (pathname === '/api/repos/linkwarden/sessions/runs') return json({ runs: [] });
      return json({ error: 'not found' }, 404);
    });

    renderAt('/preview/repos/linkwarden/activity');

    // The real view's own empty state, which on this surface offers the first
    // scan rather than naming a CLI command.
    expect(await screen.findByText('No agentic runs yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start scan' })).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(typeof input === 'string' ? input : (input as Request).url).includes(
            '/api/repos/linkwarden/sessions/runs',
          ),
        ),
      ).toBe(true),
    );
    // Not the mock: its runs are hand-written, and none of them is here.
    expect(screen.queryByText('spec scan')).toBeNull();
  });

  it('leaves a fixture repository on the mock', async () => {
    const { fetchMock } = serve();
    renderAt('/preview/repos/orders-api/activity');

    // The mock opens on its newest hand-written run.
    expect((await screen.findAllByText('spec scan')).length).toBeGreaterThan(0);
    expect(screen.queryByText(/No agentic runs yet/)).toBeNull();
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(typeof input === 'string' ? input : (input as Request).url).includes('/sessions/runs'),
      ),
    ).toBe(false);
  });
});
