/**
 * Context › Sources: every source of the workspace, in one table.
 *
 * The page reads `GET /api/context/sources` and says nothing the answer does
 * not carry — the title, the kind, the repositories that read it, the counts
 * and, when a sync failed, the source's own note. What is asserted here is what
 * the page DOES with that answer: the row it draws, the order it draws them in
 * (worst first), the failure it puts on the row, and the source page a row
 * opens. Context LANDS here, so its address is `/preview/context`.
 *
 * A row has no menu: what can be done to a source lives on the source's page.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import type { ContextSourceView } from '@truecourse/shared';

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

/** One source of the workspace, as the server hands it over. */
const source = (over: Partial<ContextSourceView> & { id: string }): ContextSourceView => ({
  kind: 'site',
  title: over.id,
  config: { llmsTxtUrl: `https://${over.id}/llms.txt` },
  status: 'synced',
  statusNote: null,
  lastSyncAt: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  docCount: 0,
  repositories: [],
  ...over,
});

const SYNCED = source({
  id: 'site-docs-acme',
  title: 'docs.acme.com',
  docCount: 12,
  repositories: [REPO_A.name, REPO_B.name],
});

const FAILED = source({
  id: 'site-docs-other',
  title: 'docs.other.com',
  status: 'failed',
  statusNote: 'https://docs.other.com/llms.txt answered 404',
  docCount: 3,
  repositories: [REPO_B.name],
});

const NEVER = source({
  id: 'repo-acme-web',
  kind: 'repository',
  title: 'acme/web',
  config: { repoFullName: 'acme/web', include: ['docs/**'], exclude: [], branch: '' },
  status: 'never',
  lastSyncAt: null,
  repositories: [REPO_A.name],
});

const SYNCING = source({ id: 'site-syncing', title: 'docs.syncing.com', status: 'syncing' });

const PAUSED = source({ id: 'site-paused', title: 'docs.paused.com', status: 'paused' });

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface World {
  sources: ContextSourceView[];
  calls: string[];
}

function serve(over: Partial<World> = {}) {
  const state: World = {
    sources: [SYNCED, FAILED, NEVER, SYNCING, PAUSED],
    calls: [],
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
    if (url.pathname === '/api/sessions/runs') return json({ runs: [] });
    if (url.pathname === '/api/context/sources') return json({ sources: state.sources, changedAt: null });
    if (url.pathname === '/api/context/documents') return json({ documents: [], corpusAt: null });
    if (url.pathname === '/api/context/staleness') {
      return json({ changedAt: null, corpusAt: null, stale: false });
    }
    if (url.pathname === '/api/context/scan') return json({ jobId: 'job-scan' }, 202);
    return json({ error: `not found: ${url.pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

/** The router's address, so the place a row opens can be asserted. */
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
  const table = screen.getByRole('table', { name: 'Sources' });
  return within(table).getAllByRole('row').slice(1);
}

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('Context, the sources', () => {
  it('draws one row per source, in the words the server stored', async () => {
    serve();
    renderAt('/preview/context');

    await waitFor(() => expect(rows()).toHaveLength(5));
    // Worst first: failed, never, syncing, paused, synced.
    const [, never, , paused, synced] = rows();

    expect(within(synced!).getByText('docs.acme.com')).toBeInTheDocument();
    expect(within(synced!).getByText('Documentation site')).toBeInTheDocument();
    // Past one repository the column counts them rather than listing them.
    expect(within(synced!).getByText('2 repositories')).toBeInTheDocument();
    expect(within(synced!).getByText('Synced')).toBeInTheDocument();
    expect(within(synced!).getByText('12')).toBeInTheDocument();

    expect(within(never!).getByText('Repository')).toBeInTheDocument();
    expect(within(never!).getByText('Never synced')).toBeInTheDocument();
    // The one repository that reads it, by name; nothing has synced it, so
    // there is no last sync to name.
    expect(within(never!).getAllByText('acme/web')).toHaveLength(2);
    expect(within(never!).getByText('—')).toBeInTheDocument();

    expect(within(paused!).getByText('Paused')).toBeInTheDocument();
    // A source no repository reads names none.
    expect(within(paused!).getByText('—')).toBeInTheDocument();
  });

  it('puts the worst first: failed, never, syncing, paused, synced', async () => {
    serve();
    renderAt('/preview/context');

    await waitFor(() => expect(rows()).toHaveLength(5));
    expect(rows().map((row) => row.querySelector('td')?.textContent)).toEqual([
      'docs.other.com',
      'acme/web',
      'docs.syncing.com',
      'docs.paused.com',
      'docs.acme.com',
    ]);
  });

  it('says why a source failed, in the source’s own words', async () => {
    serve();
    renderAt('/preview/context');

    await waitFor(() => expect(rows()).toHaveLength(5));
    const failed = rows()[0]!;
    expect(within(failed).getByText('Failed')).toBeInTheDocument();
    expect(
      within(failed).getByText('https://docs.other.com/llms.txt answered 404'),
    ).toBeInTheDocument();
  });

  it('searches the title', async () => {
    serve();
    renderAt('/preview/context');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(5));

    await user.type(screen.getByRole('textbox', { name: 'Search sources' }), 'paused');
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(within(rows()[0]!).getByText('docs.paused.com')).toBeInTheDocument();
  });

  it('opens the page of the source a row names, on a single click', async () => {
    serve();
    renderAt('/preview/context');
    const user = userEvent.setup();
    await waitFor(() => expect(rows()).toHaveLength(5));

    await user.click(rows()[0]!);
    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent(
        `/preview/context/sources/${FAILED.id}`,
      ),
    );
  });

  it('offers nothing else on a row: a source is acted on from its page', async () => {
    serve();
    renderAt('/preview/context');
    await waitFor(() => expect(rows()).toHaveLength(5));

    for (const row of rows()) {
      expect(within(row).queryByRole('button')).toBeNull();
    }
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('says what to do when the workspace has no source at all', async () => {
    serve({ sources: [] });
    renderAt('/preview/context');

    expect(
      await screen.findByText('No source yet. Add context to connect one.'),
    ).toBeInTheDocument();
  });

  it("carries the workspace's own actions: Add context, and the Document scan", async () => {
    const state = serve({ sources: [] });
    renderAt('/preview/context');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Scan' }));
    await waitFor(() => expect(state.calls).toContain('POST /api/context/scan'));

    await user.click(screen.getByRole('button', { name: 'Add context' }));
    expect(await screen.findByRole('list', { name: 'Kinds of source' })).toBeInTheDocument();
  });
});
