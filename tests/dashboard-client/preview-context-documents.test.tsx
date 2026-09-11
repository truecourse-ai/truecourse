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
import type { ContextDocumentRow, ContextSourceView } from '@truecourse/shared';

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
  config: { repoFullName: 'acme/web', include: ['docs/**'], exclude: ['**/CHANGELOG*'], branch: '' },
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

interface World {
  documents: ContextDocumentRow[];
  sources: ContextSourceView[];
  stale: boolean;
  runs: unknown[];
  calls: string[];
  check: { title: string; count: number; titles: string[]; skipped: [] };
}

function serve(over: Partial<World> = {}) {
  const state: World = {
    documents: [REFUNDS, ONBOARDING],
    sources: [REPO_SOURCE, SITE],
    stale: false,
    runs: [],
    calls: [],
    check: { title: 'docs.other.com', count: 3, titles: ['Getting started', 'Webhooks'], skipped: [] },
    ...over,
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    state.calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    if (url.pathname === '/api/repos') return json([REPO_A, REPO_B]);
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
  it('becomes that source: the crumb and its sync status, and nothing to press', async () => {
    serve();
    renderAt(`/preview/context/documents?source=${SITE.id}`);

    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Context' })).toHaveAttribute(
      'href',
      '/preview/context',
    );
    expect(await screen.findByRole('heading', { name: 'docs.acme.com' })).toBeInTheDocument();
    expect(screen.getByText('Synced')).toBeInTheDocument();

    // What can be done to a source is on the Sources list, in the row's menu.
    expect(screen.queryByRole('button', { name: 'Sync now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('names a repository source and its sync status, and spells out no scope in the header', async () => {
    serve();
    renderAt(`/preview/context/documents?source=${REPO_SOURCE.id}`);

    expect(await screen.findByRole('heading', { name: 'acme/web' })).toBeInTheDocument();
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
  it('offers the two kinds that work and locks the rest', async () => {
    serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    const list = await screen.findByRole('list', { name: 'Kinds of source' });
    expect(within(list).getByText('Repository')).toBeInTheDocument();
    expect(within(list).getByText('Documentation site')).toBeInTheDocument();
    expect(within(list).getAllByText('Coming soon')).toHaveLength(6);
    expect(within(list).getByRole('button', { name: /Jira/ })).toBeDisabled();
  });

  it('checks a scope before anything is stored, then links and adds', async () => {
    const state = serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    await user.click(await screen.findByRole('button', { name: /Documentation site/ }));

    await user.type(screen.getByLabelText('llms.txt URL'), 'https://docs.other.com/llms.txt');
    await user.click(screen.getByRole('button', { name: 'Check' }));

    expect(await screen.findByText(/docs\.other\.com yields 3 documents/)).toBeInTheDocument();
    expect(screen.getByText('Getting started')).toBeInTheDocument();
    expect(state.calls).toContain('POST /api/context/sources/preview');
    // Checking stores nothing.
    expect(state.calls).not.toContain('POST /api/context/sources');

    // The third step: which repositories read it, none by default.
    const link = await screen.findByLabelText('acme/web');
    expect(link).not.toBeChecked();
    await user.click(link);
    await user.click(screen.getByRole('button', { name: 'Add and sync' }));

    await waitFor(() => expect(state.calls).toContain('POST /api/context/sources'));
    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent(
        '/preview/context/documents?source=site-docs-other',
      ),
    );
  });

  it('refuses a second source for a repository that already has one', async () => {
    serve();
    renderAt('/preview/context/documents');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Add context' }));
    await user.click(await screen.findByRole('button', { name: /Repository/ }));
    await user.click(await screen.findByRole('button', { name: 'acme/web' }));

    expect(await screen.findByText(/already has a source/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
  });
});
