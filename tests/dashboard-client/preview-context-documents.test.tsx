/**
 * Context › Documents: every document of the workspace, in one table.
 *
 * The page is real all the way down — it reads `GET /api/context/documents`,
 * whose rows the server composed and whose status the server folded — so what
 * is asserted here is what the page DOES with that answer: the row it draws,
 * the filters it puts in the address, the source it narrows to and the actions
 * that narrowing brings, and the one scan the workspace has.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import type {
  ContextDocumentRow,
  ContextSourceView,
  GithubInstallableRepo,
  GithubInstallationSummary,
} from '@truecourse/shared';

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

import PreviewApp from '@/preview/PreviewApp';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const REPO_A = {
  id: 'web',
  name: 'acme/web',
  path: 'acme/web',
  remoteUrl: 'https://github.com/acme/web',
};
const REPO_B = {
  id: 'api',
  name: 'acme/api',
  path: 'acme/api',
  remoteUrl: 'https://github.com/acme/api',
};

const SITE: ContextSourceView = {
  id: 'site-docs-acme',
  kind: 'site',
  title: 'docs.acme.com',
  config: { llmsTxtUrl: 'https://docs.acme.com/llms.txt' },
  status: 'synced',
  statusNote: null,
  lastSyncAt: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  docCount: 1,
  repositories: [REPO_A.name, REPO_B.name],
};

const REPO_SOURCE: ContextSourceView = {
  id: 'repo-acme-web',
  kind: 'repository',
  title: 'acme/web',
  config: { repoFullName: 'acme/web', installationId: 11, include: ['docs/**'], exclude: ['**/CHANGELOG*'], branch: '' },
  status: 'never',
  statusNote: null,
  lastSyncAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  docCount: 1,
  repositories: [REPO_A.name],
};

const REFUNDS: ContextDocumentRow = {
  ref: 'context/site-docs-acme/refunds.md',
  title: 'Refunds',
  area: 'acme/payments',
  sourceId: SITE.id,
  sourceTitle: SITE.title,
  sourceKind: 'site',
  repositories: [REPO_B.name, REPO_A.name],
  readings: [
    { repository: REPO_B.name, status: 'failed' },
    { repository: REPO_A.name, status: 'proved' },
  ],
  status: 'failed',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const ONBOARDING: ContextDocumentRow = {
  ref: 'context/repo-acme-web/docs/onboarding.md',
  title: 'Onboarding',
  area: 'acme/growth',
  sourceId: REPO_SOURCE.id,
  sourceTitle: REPO_SOURCE.title,
  sourceKind: 'repository',
  repositories: [],
  readings: [],
  status: 'not-linked',
  updatedAt: '2026-08-20T10:00:00.000Z',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The two accounts the workspace can read repositories through. */
const ACME_ACCOUNT: GithubInstallationSummary = {
  installationId: 11,
  accountLogin: 'acme',
  accountType: 'Organization',
};
const OTHER_ACCOUNT: GithubInstallationSummary = {
  installationId: 22,
  accountLogin: 'contoso',
  accountType: 'Organization',
};

/** What each account can see, including a repository Code has NOT connected. */
const ACME_REPOS: GithubInstallableRepo[] = [
  { fullName: 'acme/web', defaultBranch: 'main', private: true },
  { fullName: 'acme/handbook', defaultBranch: 'trunk', private: false },
];
const OTHER_REPOS: GithubInstallableRepo[] = [
  { fullName: 'contoso/docs', defaultBranch: 'main', private: false },
];

interface World {
  documents: ContextDocumentRow[];
  sources: ContextSourceView[];
  /** The registry, as `/api/repos` answers it. */
  repos: unknown[];
  /** The workspace's GitHub accounts, as `/api/github/status` answers them. */
  installations: GithubInstallationSummary[];
  /** What each account can see, by installation id. */
  installationRepos: Record<number, GithubInstallableRepo[]>;
  stale: boolean;
  runs: unknown[];
  calls: string[];
  /** Every write, with the body it carried. */
  posts: { path: string; body: Record<string, unknown> }[];
  check: { title: string; count: number; titles: string[]; skipped: [] };
}

function serve(over: Partial<World> = {}) {
  const state: World = {
    documents: [REFUNDS, ONBOARDING],
    sources: [REPO_SOURCE, SITE],
    repos: [REPO_A, REPO_B],
    installations: [ACME_ACCOUNT],
    installationRepos: { [ACME_ACCOUNT.installationId]: ACME_REPOS, [OTHER_ACCOUNT.installationId]: OTHER_REPOS },
    stale: false,
    runs: [],
    calls: [],
    posts: [],
    check: { title: 'docs.other.com', count: 3, titles: ['Getting started', 'Webhooks'], skipped: [] },
    ...over,
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    state.calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    if (method !== 'GET') {
      state.posts.push({
        path: url.pathname,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : {},
      });
    }
    if (url.pathname === '/api/repos') return json(state.repos);
    if (url.pathname === '/api/github/status') {
      return json({ configured: true, installUrl: '', installations: state.installations, repos: [] });
    }
    const installationRepos = /^\/api\/github\/installations\/(\d+)\/repos$/.exec(url.pathname);
    if (installationRepos) {
      return json({ repos: state.installationRepos[Number(installationRepos[1])] ?? [] });
    }
    if (url.pathname === '/api/llm/config') {
      return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    }
    if (url.pathname === '/api/sessions/runs') return json({ runs: state.runs });
    if (url.pathname === '/api/context/documents') return json({ documents: state.documents, corpusAt: '2026-09-02T00:00:00.000Z' });
    if (url.pathname === '/api/context/sources') {
      if (method === 'POST') return json({ source: { ...SITE, id: 'site-docs-other' }, jobId: 'job-1' }, 202);
      return json({ sources: state.sources, changedAt: null });
    }
    if (url.pathname === '/api/context/sources/preview') return json(state.check);
    if (url.pathname === '/api/context/staleness') {
      return json({ changedAt: null, corpusAt: null, stale: state.stale });
    }
    if (url.pathname === '/api/context/scan') return json({ jobId: 'job-scan' }, 202);
    if (/^\/api\/context\/sources\/[^/]+\/sync$/.test(url.pathname)) {
      return json({ jobId: 'job-sync' }, 202);
    }
    if (/^\/api\/context\/sources\/[^/]+\/pause$/.test(url.pathname)) return json({ source: SITE });
    if (url.pathname === `/api/context/sources/${SITE.id}`) {
      return json({ removed: SITE, repositories: SITE.repositories });
    }
    return json({ error: `not found: ${url.pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

/** The router's address, so a URL-backed selection can be asserted. */
function Address() {
  const { pathname, search } = useLocation();
  return <div data-testid="address">{`${pathname}${search}`}</div>;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
      <Address />
      <Toaster />
    </MemoryRouter>,
  );
}

function rows() {
  const table = screen.getByRole('table', { name: 'Documents' });
  return within(table).getAllByRole('row').slice(1);
}

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('Context, the documents', () => {
  it('draws one row per document, in the words the server folded', async () => {
    serve();
    renderAt('/preview/context/documents');

    await waitFor(() => expect(rows()).toHaveLength(2));
    const [refunds, onboarding] = rows();
    expect(within(refunds!).getByText('Refunds')).toBeInTheDocument();
    expect(within(refunds!).getByText('acme/payments')).toBeInTheDocument();
    expect(within(refunds!).getByText('docs.acme.com')).toBeInTheDocument();
    // Past one repository the column counts them rather than listing them.
    expect(within(refunds!).getByText('2 repositories')).toBeInTheDocument();
    expect(within(refunds!).getByText('Failed')).toBeInTheDocument();

    // A document nothing reads says exactly that, and names no repository.
    expect(within(onboarding!).getByText('Not linked')).toBeInTheDocument();
    expect(within(onboarding!).getByText('—')).toBeInTheDocument();
  });

  it('names the one repository that reads a document', async () => {
    serve({ documents: [{ ...REFUNDS, repositories: [REPO_A.name] }] });
    renderAt('/preview/context/documents');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('acme/web')).toBeInTheDocument();
  });

  it('searches the title and puts a picked filter in the address', async () => {
    serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    const search = screen.getByRole('textbox', { name: 'Search documents' });
    await user.type(search, 'refund');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await user.clear(search);

    await user.click(screen.getByRole('button', { name: 'Add filter' }));
    await user.click(await screen.findByRole('option', { name: /Status/ }));
    await user.click(await screen.findByRole('option', { name: /Not linked/ }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByTestId('address')).toHaveTextContent(
      '/preview/context/documents?status=not-linked',
    );
    expect(within(rows()[0]!).getByText('Onboarding')).toBeInTheDocument();
  });

  it('narrows to a repository the address names', async () => {
    serve();
    renderAt(`/preview/context/documents?repo=${encodeURIComponent(REPO_A.name)}`);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('Refunds')).toBeInTheDocument();
  });

  it('opens a document from its row', async () => {
    serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(2));

    await user.click(rows()[0]!);
    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent(
        '/preview/context/doc/context%2Fsite-docs-acme%2Frefunds.md',
      ),
    );
  });
});

describe('narrowed to one source', () => {
  it('sits under that source, carries its sync status, and has nothing to press', async () => {
    serve();
    renderAt(`/preview/context/documents?source=${SITE.id}`);

    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Context' })).toHaveAttribute(
      'href',
      '/preview/context',
    );
    // The trail leads back through the source's own page.
    expect(within(crumbs).getByRole('link', { name: 'docs.acme.com' })).toHaveAttribute(
      'href',
      `/preview/context/sources/${SITE.id}`,
    );
    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();

    // What can be done to a source is on the source's own page.
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('names a repository source in its trail, and spells out no scope in the header', async () => {
    serve();
    renderAt(`/preview/context/documents?source=${REPO_SOURCE.id}`);

    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'acme/web' })).toHaveAttribute(
      'href',
      `/preview/context/sources/${REPO_SOURCE.id}`,
    );
    expect(screen.getByText('Never synced')).toBeInTheDocument();
    expect(screen.queryByText('the default branch')).toBeNull();
    expect(screen.queryByText(/docs\/\*\*/)).toBeNull();
  });
});

describe('the workspace scan', () => {
  it('starts the one Document scan the workspace has', async () => {
    const state = serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Scan' }));
    await waitFor(() => expect(state.calls).toContain('POST /api/context/scan'));
  });

  it('carries an amber dot while the context has moved since the corpus', async () => {
    serve({ stale: true });
    renderAt('/preview/context/documents');
    expect(await screen.findByLabelText('scan pending')).toBeInTheDocument();
  });

  it('says it is scanning while the workspace run is up, and offers no second start', async () => {
    serve({
      stale: true,
      runs: [
        {
          command: 'spec-scan',
          runId: 'run-ws',
          gitRef: 'workspace',
          startedAt: '2026-09-02T00:00:00.000Z',
          status: 'running',
          sessions: [],
          repo: null,
        },
      ],
    });
    renderAt('/preview/context/documents');

    const button = await screen.findByRole('button', { name: 'Scanning…' });
    expect(button).toBeDisabled();
    expect(screen.queryByLabelText('scan pending')).toBeNull();
  });
});

describe('Add context', () => {
  it('offers the two kinds that need no account, and sends the tools to Settings', async () => {
    serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    const list = await screen.findByRole('list', { name: 'Kinds of source' });
    // The whole row is the button, and there are only the two account-free kinds.
    const rows = within(list).getAllByRole('button');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Repository');
    expect(rows[1]).toHaveTextContent('Documentation site');
    // The tool kinds are named on Settings › Connections, not here.
    expect(within(list).queryByText('Jira')).toBeNull();
    expect(within(list).queryByText('Coming soon')).toBeNull();
    expect(
      within(list).getByRole('link', { name: 'Connect another tool in Settings' }),
    ).toHaveAttribute('href', '/preview/settings/connections');
  });

  it('checks a scope before anything is stored, then adds with no link', async () => {
    const state = serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    await user.click(await screen.findByRole('button', { name: /Documentation site/ }));

    await user.type(screen.getByLabelText('llms.txt URL'), 'https://docs.other.com/llms.txt');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    // A site's yield counts PAGES, in the words of the kind that was checked.
    expect(await screen.findByText(/docs\.other\.com yields 3 pages/)).toBeInTheDocument();
    expect(screen.getByText('Getting started')).toBeInTheDocument();
    expect(state.calls).toContain('POST /api/context/sources/preview');
    // Checking stores nothing.
    expect(state.calls).not.toContain('POST /api/context/sources');

    // Which repositories read it is Code's side: the dialog never asks.
    expect(screen.queryByLabelText('acme/web')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add and sync' }));

    await waitFor(() => expect(state.calls).toContain('POST /api/context/sources'));
    expect(state.posts.find((p) => p.path === '/api/context/sources')?.body).toMatchObject({
      repoIds: [],
    });
    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent(
        '/preview/context/documents?source=site-docs-other',
      ),
    );
  });

  it('names where you are with a stepper, and says what Check does for THIS kind', async () => {
    serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    const dialog = await screen.findByRole('dialog');
    for (const name of ['Source', 'Scope']) {
      expect(within(dialog).getByText(name)).toBeInTheDocument();
    }
    expect(within(dialog).queryByText('Link')).toBeNull();
    expect(within(dialog).queryByText(/Step \d of \d/)).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: /Documentation site/ }));
    expect(
      await within(dialog).findByText(
        'Check reads the llms.txt and counts the pages it lists; nothing is stored yet.',
      ),
    ).toBeInTheDocument();
  });

  it('lists what the account can see, disabling a repository that already has a source', async () => {
    serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    await user.click(await screen.findByRole('button', { name: /Repository/ }));

    // The repository is a select, never a row of chips.
    const select = await screen.findByLabelText('Repository');
    expect(select.tagName).toBe('SELECT');
    // A repository Code has NOT connected is offered: a source reads through
    // the account, not through the Code link.
    expect(await within(select).findByRole('option', { name: 'acme/handbook' })).toBeInTheDocument();
    const taken = await within(select).findByRole('option', { name: 'acme/web · already a source' });
    expect(taken).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
    // One account needs no picking, so no account select is drawn.
    expect(screen.queryByLabelText('Account')).toBeNull();
    // The scope copy is the repository's, not one generic line for both kinds.
    expect(
      screen.getByText(
        'Check walks the branch with these patterns and counts the files it would keep; nothing is stored yet.',
      ),
    ).toBeInTheDocument();
  });

  it('picks the account first when the workspace has more than one', async () => {
    const state = serve({ installations: [ACME_ACCOUNT, OTHER_ACCOUNT] });
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    await user.click(await screen.findByRole('button', { name: /Repository/ }));

    const account = await screen.findByLabelText('Account');
    expect(within(account).getByRole('option', { name: 'acme' })).toBeInTheDocument();
    expect(within(account).getByRole('option', { name: 'contoso' })).toBeInTheDocument();

    // The first account's repositories are read; picking the other reads its own.
    const select = await screen.findByLabelText('Repository');
    expect(await within(select).findByRole('option', { name: 'acme/handbook' })).toBeInTheDocument();
    await user.selectOptions(account, String(OTHER_ACCOUNT.installationId));
    expect(await within(select).findByRole('option', { name: 'contoso/docs' })).toBeInTheDocument();
    expect(state.calls).toContain(`/api/github/installations/${OTHER_ACCOUNT.installationId}/repos`);
  });

  it('sends the user to Settings when no account is connected', async () => {
    serve({ installations: [] });
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    await user.click(await screen.findByRole('button', { name: /Repository/ }));

    expect(await screen.findByText('No GitHub account connected yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect an account in Settings' })).toHaveAttribute(
      'href',
      '/preview/settings/repositories?from=context-add',
    );
    expect(screen.queryByLabelText('Repository')).toBeNull();
  });

  it('reopens at the Repository step when the install returns to ?add=repository', async () => {
    serve();
    renderAt('/preview/context/documents?add=repository');

    // No click: the dialog is open on the repository step with the account read.
    expect(await screen.findByRole('dialog', { name: 'Add context' })).toBeInTheDocument();
    expect(await screen.findByLabelText('Repository')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Documentation site/ })).toBeNull();
  });

  it('opens at the kind step when the address says ?add=1', async () => {
    serve();
    renderAt('/preview/context/documents?add=1');

    // No click: Home's checkpoint sends the reader here with the dialog open on
    // the first step, both kinds offered and none chosen.
    expect(await screen.findByRole('dialog', { name: 'Add context' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Documentation site/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Repository/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Repository')).toBeNull();
  });

  it('offers Settings under the repository picker', async () => {
    serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    await user.click(await screen.findByRole('button', { name: /Repository/ }));

    expect(await screen.findByRole('combobox', { name: 'Repository' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect another account in Settings' })).toHaveAttribute(
      'href',
      '/preview/settings/repositories?from=context-add',
    );
  });

  it('checks and adds an unconnected repository through its account', async () => {
    const state = serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    await user.click(await screen.findByRole('button', { name: /Repository/ }));
    const select = await screen.findByLabelText('Repository');
    await within(select).findByRole('option', { name: 'acme/handbook' });
    await user.selectOptions(select, 'acme/handbook');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    await waitFor(() =>
      expect(state.posts.some((p) => p.path === '/api/context/sources/preview')).toBe(true),
    );
    expect(state.posts.find((p) => p.path === '/api/context/sources/preview')?.body).toMatchObject({
      kind: 'repository',
      installationId: ACME_ACCOUNT.installationId,
      config: { repoFullName: 'acme/handbook' },
    });

    await user.click(await screen.findByRole('button', { name: 'Add and sync' }));
    await waitFor(() =>
      expect(state.posts.some((p) => p.path === '/api/context/sources')).toBe(true),
    );
    expect(state.posts.find((p) => p.path === '/api/context/sources')?.body).toMatchObject({
      kind: 'repository',
      installationId: ACME_ACCOUNT.installationId,
      repoIds: [],
    });
  });

  it('adds a repository source with nothing connected in Code', async () => {
    const state = serve({ repos: [] });
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    await user.click(await screen.findByRole('button', { name: /Repository/ }));
    const select = await screen.findByLabelText('Repository');
    await within(select).findByRole('option', { name: 'acme/handbook' });
    await user.selectOptions(select, 'acme/handbook');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    await user.click(await screen.findByRole('button', { name: 'Add and sync' }));
    await waitFor(() =>
      expect(state.posts.some((p) => p.path === '/api/context/sources')).toBe(true),
    );
    expect(state.posts.find((p) => p.path === '/api/context/sources')?.body).toMatchObject({
      repoIds: [],
    });
  });
});
