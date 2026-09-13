/**
 * Context › Sources › <source>: the page a source row opens.
 *
 * It reads `GET /api/context/sources/:id` and renders exactly what comes back —
 * the stored scope in its fields, the repositories that read it, the syncs it
 * has had and, on a failure, the source's own note. What is asserted here is
 * what the page DOES with that answer: the trail it sits under, the scope it
 * saves (and only when something changed), the link it PUTs, the documents it
 * points at, and the actions in its header.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import type { ContextSourceView, ContextSyncRecord } from '@truecourse/shared';

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
  lastSyncAt: '2026-09-10T10:00:00.000Z',
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-09-10T10:00:00.000Z',
  docCount: 12,
  repositories: [REPO_A.name],
};

const REPO_SOURCE: ContextSourceView = {
  id: 'repo-acme-web',
  kind: 'repository',
  title: 'acme/web',
  config: {
    repoFullName: 'acme/web',
    installationId: 11,
    include: ['docs/**', '**/*.md'],
    exclude: ['**/CHANGELOG*'],
    branch: '',
  },
  status: 'never',
  statusNote: null,
  lastSyncAt: null,
  createdAt: '2026-08-01T10:00:00.000Z',
  updatedAt: '2026-08-01T10:00:00.000Z',
  docCount: 0,
  repositories: [REPO_A.name],
};

const SYNCS: ContextSyncRecord[] = [
  {
    sourceId: SITE.id,
    at: '2026-09-10T10:00:00.000Z',
    parentAt: '2026-09-03T10:00:00.000Z',
    added: 2,
    changed: 1,
    removed: 0,
    unchanged: 9,
  },
  {
    sourceId: SITE.id,
    at: '2026-09-03T10:00:00.000Z',
    parentAt: null,
    added: 10,
    changed: 0,
    removed: 0,
    unchanged: 0,
  },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

interface World {
  sources: ContextSourceView[];
  syncs: ContextSyncRecord[];
  /** The answer a PATCH gives, so a refusal and a paused save can be driven. */
  patch: () => Response;
  linked: string[];
  calls: string[];
  bodies: unknown[];
}

function serve(over: Partial<World> = {}) {
  const state: World = {
    sources: [SITE, REPO_SOURCE],
    syncs: SYNCS,
    patch: () => json({ source: SITE, jobId: 'job-sync' }, 202),
    linked: [],
    calls: [],
    bodies: [],
    ...over,
  };
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    state.calls.push(
      method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`,
    );
    if (init?.body) state.bodies.push(JSON.parse(String(init.body)));
    if (url.pathname === '/api/repos') return json([REPO_A, REPO_B]);
    if (url.pathname === '/api/llm/config') {
      return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    }
    if (url.pathname === '/api/sessions/runs') return json({ runs: [] });
    if (url.pathname === '/api/context/sources') {
      return json({ sources: state.sources, changedAt: null });
    }
    if (url.pathname === '/api/context/documents') return json({ documents: [], corpusAt: null });
    if (url.pathname === '/api/context/staleness') {
      return json({ changedAt: null, corpusAt: null, stale: false });
    }
    if (url.pathname === '/api/context/scan') return json({ jobId: 'job-scan' }, 202);
    if (/^\/api\/repos\/[^/]+\/context\/bindings$/.test(url.pathname)) {
      if (method === 'PUT') {
        state.linked = (JSON.parse(String(init?.body ?? '{}')) as { sourceIds: string[] }).sourceIds;
      }
      return json({ repoFullName: REPO_B.name, sourceIds: state.linked });
    }
    if (/^\/api\/context\/sources\/[^/]+\/sync$/.test(url.pathname)) {
      return json({ jobId: 'job-sync' }, 202);
    }
    if (/^\/api\/context\/sources\/[^/]+\/pause$/.test(url.pathname)) {
      const { paused } = JSON.parse(String(init?.body ?? '{}')) as { paused: boolean };
      state.sources = state.sources.map((source) =>
        source.id === SITE.id ? { ...source, status: paused ? 'paused' : 'synced' } : source,
      );
      return json({ source: state.sources.find((source) => source.id === SITE.id) });
    }
    const one = /^\/api\/context\/sources\/([^/]+)$/.exec(url.pathname);
    if (one) {
      if (method === 'PATCH') return state.patch();
      if (method === 'DELETE') return json({ removed: SITE, repositories: SITE.repositories });
      const source = state.sources.find((s) => s.id === decodeURIComponent(one[1]!));
      if (!source) return json({ error: `not found: ${one[1]}` }, 404);
      return json({
        source,
        syncs: state.syncs.filter((sync) => sync.sourceId === source.id),
      });
    }
    return json({ error: `not found: ${url.pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return state;
}

/** The router's address, so where an action leaves the reader can be asserted. */
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

const at = (source: ContextSourceView) => `/preview/context/sources/${source.id}`;

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('the source page', () => {
  it('sits under Context › Sources and says where the source stands', async () => {
    serve();
    renderAt(at(SITE));

    expect(await screen.findByRole('heading', { name: 'docs.acme.com' })).toBeInTheDocument();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Context' })).toHaveAttribute(
      'href',
      '/preview/context',
    );
    expect(within(crumbs).getByRole('link', { name: 'Sources' })).toHaveAttribute(
      'href',
      '/preview/context',
    );
    expect(screen.getByText('Synced')).toBeInTheDocument();
    // The workspace's own actions ride along, on every Context page.
    expect(screen.getByRole('button', { name: 'Scan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add context' })).toBeInTheDocument();
  });

  it('is where a Sources row goes', async () => {
    serve();
    renderAt('/preview/context');
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Sources' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(3));
    await user.click(within(table).getAllByRole('row')[1]!);
    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent(at(REPO_SOURCE)),
    );
  });
});

describe('the scope', () => {
  it("shows a site's stored URL, and saves a new one", async () => {
    const state = serve();
    renderAt(at(SITE));
    const user = userEvent.setup();

    const url = await screen.findByLabelText('llms.txt URL');
    expect(url).toHaveValue('https://docs.acme.com/llms.txt');
    // Nothing has changed, so there is nothing to save.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(url);
    await user.type(url, 'https://docs.acme.com/docs/llms.txt');
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();

    const before = state.calls.filter((c) => c === `/api/context/sources/${SITE.id}`).length;
    await user.click(save);
    await waitFor(() =>
      expect(state.calls).toContain(`PATCH /api/context/sources/${SITE.id}`),
    );
    expect(state.bodies).toContainEqual({
      config: { llmsTxtUrl: 'https://docs.acme.com/docs/llms.txt' },
    });
    // And the page re-reads what it just stored.
    await waitFor(() =>
      expect(
        state.calls.filter((c) => c === `/api/context/sources/${SITE.id}`).length,
      ).toBeGreaterThan(before),
    );
  });

  it("shows a repository's stored branch and patterns, and saves them", async () => {
    const state = serve({ patch: () => json({ source: REPO_SOURCE, jobId: 'job-sync' }, 202) });
    renderAt(at(REPO_SOURCE));
    const user = userEvent.setup();

    // The repository itself is what the source IS: it is read, never edited.
    expect(await screen.findByText('acme/web', { selector: 'p' })).toBeInTheDocument();
    const branch = screen.getByLabelText('Branch');
    expect(branch).toHaveValue('');
    expect(branch).toHaveAttribute('placeholder', 'the default branch');
    expect(screen.getByLabelText('Include patterns')).toHaveValue('docs/**\n**/*.md');
    expect(screen.getByLabelText('Exclude patterns')).toHaveValue('**/CHANGELOG*');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.type(branch, 'develop');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.calls).toContain(`PATCH /api/context/sources/${REPO_SOURCE.id}`),
    );
    expect(state.bodies).toContainEqual({
      config: {
        repoFullName: 'acme/web',
        branch: 'develop',
        include: ['docs/**', '**/*.md'],
        exclude: ['**/CHANGELOG*'],
      },
    });
  });

  it('says what the server said when it refuses a scope', async () => {
    serve({ patch: () => json({ error: 'https://nope.example/ is not an llms.txt URL.' }, 400) });
    renderAt(at(SITE));
    const user = userEvent.setup();

    const url = await screen.findByLabelText('llms.txt URL');
    await user.clear(url);
    await user.type(url, 'https://nope.example/');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('https://nope.example/ is not an llms.txt URL.'),
    ).toBeInTheDocument();
  });

  it('says in the server’s words when a save started no sync', async () => {
    serve({
      patch: () =>
        json(
          {
            source: { ...SITE, status: 'paused' },
            note: 'docs.acme.com is paused. Resume it to sync this scope.',
          },
          202,
        ),
    });
    renderAt(at(SITE));
    const user = userEvent.setup();

    const url = await screen.findByLabelText('llms.txt URL');
    await user.clear(url);
    await user.type(url, 'https://docs.acme.com/v2/llms.txt');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(
      await screen.findByText('docs.acme.com is paused. Resume it to sync this scope.'),
    ).toBeInTheDocument();
  });
});

describe('who reads the source', () => {
  it('switches every connected repository, and links one by saving that repository’s set', async () => {
    const state = serve();
    renderAt(at(SITE));
    const user = userEvent.setup();

    const reads = await screen.findByRole('list', { name: 'Read by' });
    const web = within(reads).getByRole('switch', { name: 'acme/web linked' });
    const api = within(reads).getByRole('switch', { name: 'acme/api linked' });
    expect(web).toHaveAttribute('aria-checked', 'true');
    expect(api).toHaveAttribute('aria-checked', 'false');

    await user.click(api);
    // The whole set is saved, read first so nothing else this repository reads is lost.
    await waitFor(() => expect(state.calls).toContain(`/api/repos/${REPO_B.id}/context/bindings`));
    await waitFor(() =>
      expect(state.calls).toContain(`PUT /api/repos/${REPO_B.id}/context/bindings`),
    );
    expect(state.bodies).toContainEqual({ sourceIds: [SITE.id] });
  });

  it('cannot unlink a repository source from its own repository, and says why', async () => {
    serve();
    renderAt(at(REPO_SOURCE));

    const reads = await screen.findByRole('list', { name: 'Read by' });
    const own = within(reads).getByRole('switch', { name: 'acme/web linked' });
    expect(own).toHaveAttribute('aria-checked', 'true');
    expect(own).toBeDisabled();
    expect(within(reads).getByText('its own repository')).toBeInTheDocument();
    expect(within(reads).getByRole('switch', { name: 'acme/api linked' })).toBeEnabled();
  });
});

describe('the syncs', () => {
  it('lists them newest first, with what each reconciled', async () => {
    serve();
    renderAt(at(SITE));

    const table = await screen.findByRole('table', { name: 'Syncs' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual([
      expect.any(String),
      '2',
      '1',
      '0',
      '9',
    ]);
    expect(within(rows[1]!).getAllByRole('cell')[1]).toHaveTextContent('10');
  });

  it('links the documents the source yielded, narrowed to it', async () => {
    serve();
    renderAt(at(SITE));

    expect(await screen.findByRole('link', { name: '12 documents' })).toHaveAttribute(
      'href',
      `/preview/context/documents?source=${SITE.id}`,
    );
  });

  it('says a source nothing has synced has no sync', async () => {
    serve();
    renderAt(at(REPO_SOURCE));

    expect(await screen.findByText('No sync yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Syncs' })).toBeNull();
  });

  it('says why the last sync failed, in the source’s own words', async () => {
    const failed: ContextSourceView = {
      ...SITE,
      status: 'failed',
      statusNote: 'https://docs.acme.com/llms.txt answered 404',
    };
    serve({ sources: [failed, REPO_SOURCE] });
    renderAt(at(SITE));

    expect(await screen.findByText('Failed')).toBeInTheDocument();
    expect(
      screen.getByText('https://docs.acme.com/llms.txt answered 404'),
    ).toBeInTheDocument();
  });
});

describe('what the header can do to the source', () => {
  it('syncs it now', async () => {
    const state = serve();
    renderAt(at(SITE));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Sync now' }));
    await waitFor(() =>
      expect(state.calls).toContain(`POST /api/context/sources/${SITE.id}/sync`),
    );
  });

  it('pauses it, and offers a paused source Resume with nothing to sync', async () => {
    const state = serve();
    renderAt(at(SITE));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Pause' }));
    await waitFor(() =>
      expect(state.calls).toContain(`POST /api/context/sources/${SITE.id}/pause`),
    );
    expect(state.bodies).toContainEqual({ paused: true });

    await waitFor(() => expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
  });

  it('removes a site once the reader confirms, and leaves for Context', async () => {
    const state = serve();
    renderAt(at(SITE));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/acme\/web reads this source/)).toBeInTheDocument();

    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(state.calls).toContain(`DELETE /api/context/sources/${SITE.id}`));
    await waitFor(() =>
      expect(screen.getByTestId('address').textContent).toBe('/preview/context'),
    );
  });

  it('offers no Remove on a repository source — it goes with its repository', async () => {
    serve();
    renderAt(at(REPO_SOURCE));

    expect(await screen.findByRole('button', { name: 'Sync now' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });
});

describe('the documents narrowed to one source', () => {
  it('leads back to the source’s page', async () => {
    serve();
    renderAt(`/preview/context/documents?source=${SITE.id}`);

    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'docs.acme.com' })).toHaveAttribute(
      'href',
      at(SITE),
    );
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
  });
});
