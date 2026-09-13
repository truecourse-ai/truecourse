/**
 * Connecting a repository through the GitHub App, from the one-product shell.
 *
 * Everything else in the preview is fake, so this file is about the seam: the
 * dialog reads the real `/api/github/status`, lists what an installation can
 * see, posts one `/api/github/repos/link` per picked repository, and the shell
 * re-reads the real `/api/repos`. A repository that came back that way renders
 * on Code with none of the fixture coverage the mock repositories have.
 *
 * The CONTEXT STEP is the second real seam: the workspace's EXISTING sources
 * come from `/api/context/sources` (connecting creates none, sources are made
 * in Context), a source that is a picked repository's own documentation leads
 * them checked, and what was picked is written per repository with
 * `PUT /api/repos/:id/context/bindings` once the link landed.
 *
 * The seam widened with the agent's own page: its conversations are the real
 * ones (`/api/sessions/runs`, over every connected repository), and a fixture
 * repository contributes none — the last describe here.
 *
 * `window.fetch` is replaced wholesale rather than routed around the preview's
 * own shim: the shim is installed once when the preview chunk loads (it never
 * uninstalls), and replacing the global is what a caller's stub does anyway.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Toaster } from 'sonner';
import type {
  GithubConnectStatusResponse,
  GithubInstallableRepo,
  GithubRepoSummary,
} from '@truecourse/shared';
import type { ContextSourceView } from '@truecourse/shared';
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
  /** The workspace's context sources, and the bindings each PUT recorded. */
  sources?: ContextSourceView[];
  /** `/api/github/status` as a Response, so a test can answer 503. */
  status?: () => Response;
  /** What each installation can see. */
  installationRepos?: Record<number, GithubInstallableRepo[]>;
  /** Async so a test can hold a link open and watch the button say so. */
  link?: (body: LinkBody) => Response | Promise<Response>;
  /** `/api/llm/config`; unanswered it 404s and the provider state stays unknown. */
  llm?: () => Response;
}

/** One workspace source, as `/api/context/sources` answers it. */
function source(over: Partial<ContextSourceView> & Pick<ContextSourceView, 'id' | 'kind' | 'title'>): ContextSourceView {
  return {
    config: {},
    status: 'never',
    statusNote: null,
    lastSyncAt: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    docCount: 0,
    repositories: [],
    ...over,
  };
}

/** A workspace source that is a repository's own documentation. */
function ownSource(repoFullName: string): ContextSourceView {
  return source({
    id: `repo-${repoFullName.replace('/', '-')}`,
    kind: 'repository',
    title: repoFullName,
    config: { repoFullName, installationId: 42, include: ['docs/**'], exclude: [], branch: 'main' },
  });
}

/** A server answering the registry, connect routes and empty guard summaries. */
function serve(backend: Backend = {}) {
  const posted: LinkBody[] = [];
  const bound: { repoId: string; sourceIds: string[] }[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (pathname === '/api/repos' && method === 'GET') return json(backend.registry ?? []);
    if (/^\/api\/repos\/[^/]+\/guard\/status$/.test(pathname)) {
      return json({ coverage: null, sections: null, lastRun: null, lastGenerate: null });
    }
    if (pathname === '/api/context/sources' && method === 'GET') {
      return json({ sources: backend.sources ?? [], changedAt: null });
    }
    const bindings = /^\/api\/repos\/([^/]+)\/context\/bindings$/.exec(pathname);
    if (bindings && method === 'PUT') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { sourceIds: string[] };
      bound.push({ repoId: bindings[1]!, sourceIds: body.sourceIds });
      return json({ repoFullName: bindings[1]!, sourceIds: body.sourceIds });
    }
    if (pathname === '/api/llm/config' && backend.llm) return backend.llm();
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
    // A newly connected repository has no stored corpus or run snapshots.
    return json({ error: 'not found' }, 404);
  });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  return { fetchMock, posted, bound };
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
      <Toaster />
    </MemoryRouter>,
  );
}

/**
 * Open the dialog on the repositories of the one installation: step 1 is the
 * connected instances and the whole row is the button.
 */
async function openGithubRepos() {
  renderAt('/preview/code?connect=1');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(await within(dialog).findByRole('button', { name: /linkwarden/ }));
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
      defaultBranch: 'trunk',
      onboarding: false,
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
  it('lists a connected repository on Code with no coverage yet', async () => {
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
    renderAt('/preview/code');
    const name = await screen.findByText('linkwarden/linkwarden');
    expect(screen.queryByText('local-thing')).toBeNull();
    // Wait for the stored summary before asserting the empty state.
    const row = name.closest('tr')!;
    expect(await within(row).findByText('no corpus yet')).toBeInTheDocument();
    expect(within(row).getByText('—')).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('button', { name: /linkwarden\/linkwarden/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    // The Context step stands between picking the repository and confirming.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect and start onboarding' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(posted).toEqual([
      { repoFullName: 'linkwarden/linkwarden', installationId: 42, defaultBranch: 'main' },
    ]);
    expect(await screen.findByText('linkwarden/linkwarden')).toBeInTheDocument();
  });

  it('toasts the no-provider remedy when a repository lands without one', async () => {
    serve({
      registry: [],
      llm: () => json({ config: null, providers: ['anthropic'] }),
      installationRepos: {
        42: [{ fullName: 'linkwarden/linkwarden', defaultBranch: 'main', private: false }],
      },
    });

    const dialog = await openGithubRepos();
    await userEvent.click(await screen.findByRole('button', { name: /linkwarden\/linkwarden/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    // The Context step stands between picking repositories and confirming.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect and start onboarding' }));

    expect(await screen.findByText('No LLM provider configured')).toBeInTheDocument();
    expect(
      await screen.findByText(
        'linkwarden/linkwarden is connected, but its scan cannot start until a provider is set.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Models' })).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('button', { name: /linkwarden\/linkwarden/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    // The Context step stands between picking repositories and confirming.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect and start onboarding' }));

    expect(await within(dialog).findByRole('button', { name: 'Connecting' })).toBeDisabled();
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('lists each connected installation as one row, which is the pick', async () => {
    serve({
      status: () => json(status({ repos: [linkedRepo('linkwarden/linkwarden')] })),
      installationRepos: { 42: [] },
    });

    renderAt('/preview/code?connect=1');
    const dialog = await screen.findByRole('dialog');
    const list = await within(dialog).findByRole('list', { name: 'Connected providers' });
    const row = await within(list).findByRole('button', { name: /linkwarden/ });
    // Every word on the row is data or a status word.
    expect(within(row).getByText('linkwarden')).toBeInTheDocument();
    expect(within(row).getByText('GitHub · organization · 1 repository linked')).toBeInTheDocument();
    expect(within(row).getByText('Connected')).toBeInTheDocument();
    // No separate Select button: the row itself is the button.
    expect(within(row).queryByRole('button')).toBeNull();

    await userEvent.click(row);
    // Step 2 names the instance the repositories come from.
    expect(await within(dialog).findByText('linkwarden')).toBeInTheDocument();
  });

  it('ends step one with the one link to Settings, and closes on the way', async () => {
    serve({ installationRepos: { 42: [] } });

    renderAt('/preview/code?connect=1');
    const dialog = await screen.findByRole('dialog');
    const link = await within(dialog).findByRole('link', {
      name: 'Connect another provider in Settings',
    });
    expect(link).toHaveAttribute('href', '/preview/settings/repositories?from=code-connect');
    // Installing the App is Settings' business, not a control inside a step.
    expect(within(dialog).queryByRole('link', { name: 'Install' })).toBeNull();
    expect(within(dialog).queryByText('Add another')).toBeNull();
    // The steps are named, never numbered.
    for (const name of ['Provider', 'Repositories', 'Context', 'Confirm']) {
      expect(within(dialog).getByText(name)).toBeInTheDocument();
    }
    expect(within(dialog).queryByText(/Step \d of \d/)).toBeNull();

    await userEvent.click(link);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('navigation', { name: 'Settings sections' })).toBeInTheDocument();
  });

  it('falls back to the installation id when the account has no name', async () => {
    serve({
      status: () =>
        json(status({ installations: [{ installationId: 42, accountLogin: '', accountType: '' }] })),
      installationRepos: { 42: [] },
    });

    renderAt('/preview/code?connect=1');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('#42')).toBeInTheDocument();
  });

  it('says what the server is missing when the App is not configured', async () => {
    const missing =
      'GitHub is not configured on this server. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, ' +
      'GITHUB_APP_WEBHOOK_SECRET and GITHUB_APP_SLUG, then restart it.';
    serve({ status: () => json({ error: missing }, 503) });

    renderAt('/preview/code?connect=1');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(missing)).toBeInTheDocument();
    // Nothing to pick: the fix is on the server. The only way on is Settings.
    const list = within(dialog).getByRole('list', { name: 'Connected providers' });
    expect(within(list).queryByRole('button')).toBeNull();
    expect(within(list).getAllByRole('link')).toHaveLength(1);
  });

  it('says nothing is connected yet when the App is installed nowhere', async () => {
    serve({ status: () => json(status({ installations: [] })) });

    renderAt('/preview/code?connect=1');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('No provider connected yet.')).toBeInTheDocument();
    const list = within(dialog).getByRole('list', { name: 'Connected providers' });
    expect(within(list).queryByRole('button')).toBeNull();
    expect(
      within(list).getByRole('link', { name: 'Connect another provider in Settings' }),
    ).toBeInTheDocument();
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
    expect(await screen.findByRole('button', { name: /linkwarden\/linkwarden/ })).toBeDisabled();
    expect(screen.getByText('connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /linkwarden\/docs/ })).toBeEnabled();
  });

  it('keeps the dialog open and names the repository the server refused', async () => {
    const { posted } = serve({
      installationRepos: {
        42: [
          { fullName: 'linkwarden/linkwarden', defaultBranch: 'main', private: false },
          { fullName: 'linkwarden/docs', defaultBranch: 'trunk', private: true },
        ],
      },
      // The picked repository is refused: the dialog stays, and says why.
      link: (body) =>
        body.repoFullName === 'linkwarden/docs'
          ? json({ error: 'repository already connected to another workspace' }, 409)
          : json({ ok: true }, 201),
    });

    const dialog = await openGithubRepos();
    await userEvent.click(await screen.findByRole('button', { name: /linkwarden\/docs/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    // The Context step stands between picking the repository and confirming.
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect and start onboarding' }));

    expect(
      await within(dialog).findByText('repository already connected to another workspace'),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Connect and start onboarding' })).toBeEnabled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect and start onboarding' }));
    // Retrying posts the refused repository again.
    await waitFor(() => expect(posted).toHaveLength(2));
    expect(posted.map((p) => p.repoFullName)).toEqual(['linkwarden/docs', 'linkwarden/docs']);
  });

  it("leads with the picked repository's own documentation, checked and named as such", async () => {
    serve({
      sources: [
        source({ id: 'site-docs', kind: 'site', title: 'docs.acme.com', docCount: 12 }),
        ownSource('linkwarden/linkwarden'),
      ],
      installationRepos: { 42: [{ fullName: 'linkwarden/linkwarden', defaultBranch: 'main', private: false }] },
    });

    const dialog = await openGithubRepos();
    await userEvent.click(await screen.findByRole('button', { name: /linkwarden\/linkwarden/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    const list = await within(dialog).findByRole('list', { name: 'Context sources' });
    await waitFor(() =>
      expect(within(within(list).getAllByRole('listitem')[0]!).getByRole('checkbox')).toBeChecked(),
    );
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("This repository’s own documentation")).toBeInTheDocument();
    expect(within(items[1]!).getByText('docs.acme.com')).toBeInTheDocument();
    expect(within(items[1]!).getByRole('checkbox')).not.toBeChecked();
    expect(within(dialog).getByRole('link', { name: 'Add context' })).toHaveAttribute(
      'href',
      '/preview/context',
    );
  });

  // Context makes the sources; connecting makes none. A repository Context has
  // never read has no own-documentation row to offer, only the rest.
  it('offers only the other sources when Context has none for the repository', async () => {
    serve({
      sources: [source({ id: 'site-docs', kind: 'site', title: 'docs.acme.com', docCount: 12 })],
      installationRepos: { 42: [{ fullName: 'linkwarden/linkwarden', defaultBranch: 'main', private: false }] },
    });

    const dialog = await openGithubRepos();
    await userEvent.click(await screen.findByRole('button', { name: /linkwarden\/linkwarden/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    const list = await within(dialog).findByRole('list', { name: 'Context sources' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(within(items[0]!).getByText('docs.acme.com')).toBeInTheDocument();
    expect(within(items[0]!).getByRole('checkbox')).not.toBeChecked();
    expect(within(dialog).queryByText("This repository’s own documentation")).toBeNull();
  });

  it('says the workspace has no source yet when there is none', async () => {
    serve({
      sources: [],
      installationRepos: { 42: [{ fullName: 'linkwarden/linkwarden', defaultBranch: 'main', private: false }] },
    });

    const dialog = await openGithubRepos();
    await userEvent.click(await screen.findByRole('button', { name: /linkwarden\/linkwarden/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    expect(
      await within(dialog).findByText('This workspace has no source yet.'),
    ).toBeInTheDocument();
  });

  // What the step picked is written per repository, and a repository's own
  // documentation is its own: the other repository in the same batch never
  // reads it.
  it('binds what the repository picked, and never another repository’s own documentation', async () => {
    const registry: RegistryEntry[] = [];
    const { bound } = serve({
      registry,
      sources: [
        ownSource('linkwarden/linkwarden'),
        ownSource('linkwarden/docs'),
        source({ id: 'site-docs', kind: 'site', title: 'docs.acme.com' }),
      ],
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
    // One repository per connect: picking the second replaces the first.
    await userEvent.click(await screen.findByRole('button', { name: /linkwarden\/docs/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: /linkwarden\/linkwarden/ }));
    expect(within(dialog).getByRole('button', { name: /linkwarden\/linkwarden/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByRole('button', { name: /linkwarden\/docs/ })).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));

    // Its own source leads the list checked; the site is added; the other
    // repository's own documentation is an ordinary row, left unchecked.
    expect(await within(dialog).findByLabelText(/own documentation/)).toBeChecked();
    expect(within(dialog).getByLabelText(/linkwarden\/docs/)).not.toBeChecked();
    await userEvent.click(within(dialog).getByLabelText(/docs\.acme\.com/));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Continue' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Connect and start onboarding' }));

    await waitFor(() =>
      expect(bound).toEqual([{ repoId: 'linkwarden', sourceIds: ['repo-linkwarden-linkwarden', 'site-docs'] }]),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders an empty Code and nothing throws with no server behind it', async () => {
    window.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof window.fetch;
    renderAt('/preview/code');
    expect(await screen.findByText('No repository connected yet.')).toBeInTheDocument();
  });
});

describe('the agent page reads the workspace route', () => {
  const CONNECTED: RegistryEntry = {
    id: 'linkwarden',
    name: 'linkwarden/linkwarden',
    path: '/clones/linkwarden__linkwarden',
    remoteUrl: 'https://github.com/linkwarden/linkwarden',
  };

  it('reads the workspace route and shows its empty line', async () => {
    const { fetchMock } = serve({ registry: [CONNECTED] });
    // The registry read is served above; the workspace runs route is the point.
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const { pathname } = new URL(href, window.location.origin);
      if (pathname === '/api/repos') return json([CONNECTED]);
      if (pathname === '/api/sessions/runs') return json({ runs: [] });
      if (pathname === '/api/repos/linkwarden/sessions/runs') return json({ runs: [] });
      return json({ error: 'not found' }, 404);
    });

    renderAt('/preview/agent');

    expect(
      await screen.findByText("Nothing yet. A repository's first scan starts the agent."),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(typeof input === 'string' ? input : (input as Request).url).includes(
            '/api/sessions/runs',
          ),
        ),
      ).toBe(true),
    );
  });

  it('gives a connected repository no Activity tab of its own', async () => {
    serve({ registry: [CONNECTED] });
    renderAt(`/preview/repos/${CONNECTED.id}/runs`);

    const menu = await screen.findByRole('navigation', { name: 'Repository sections' });
    expect(within(menu).queryByRole('link', { name: 'Activity' })).toBeNull();
  });
});
