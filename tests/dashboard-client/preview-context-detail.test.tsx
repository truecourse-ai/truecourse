/**
 * One document of Context, and one conflict of it.
 *
 * A document opens the EXISTING coverage page, read through ONE of the
 * repositories that read it — the worst one by default, switchable by the chips
 * in the header. A document nothing reads has no coverage to show and opens as
 * itself, with the repositories that could read it.
 *
 * A conflict is the workspace's, not a repository's: it is listed once, opened
 * once, and its resolver writes the workspace's decisions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ContextDocumentRow } from '@truecourse/shared';

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
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = (() => {}) as Element['scrollIntoView'];
}

const realFetch = window.fetch;

const REPO_A = { id: 'web', name: 'acme/web', path: 'acme/web', remoteUrl: 'https://github.com/acme/web' };
const REPO_B = { id: 'api', name: 'acme/api', path: 'acme/api', remoteUrl: 'https://github.com/acme/api' };

const REFUNDS_REF = 'context/site-docs-acme/refunds.md';
const PAYOUTS_REF = 'context/site-docs-acme/payouts.md';
const LONELY_REF = 'context/site-docs-acme/lonely.md';

const REFUNDS: ContextDocumentRow = {
  ref: REFUNDS_REF,
  title: 'Refunds',
  area: 'acme/payments',
  sourceId: 'site-docs-acme',
  sourceTitle: 'docs.acme.com',
  sourceKind: 'site',
  repositories: [REPO_B.name, REPO_A.name],
  // Worst first: the reading the page opens on.
  readings: [
    { repository: REPO_B.name, status: 'failed' },
    { repository: REPO_A.name, status: 'proved' },
  ],
  status: 'failed',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const LONELY: ContextDocumentRow = {
  ref: LONELY_REF,
  title: 'Nobody reads this',
  area: 'acme/platform',
  sourceId: 'site-docs-acme',
  sourceTitle: 'docs.acme.com',
  sourceKind: 'site',
  repositories: [],
  readings: [],
  status: 'not-linked',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

/** A workspace corpus with one area and one disagreement inside it. */
const CORPUS = {
  corpus: {
    version: 3,
    generatedAt: '2026-09-02T00:00:00.000Z',
    docs: [
      { ref: REFUNDS_REF, kind: 'prd', lastTouched: '', areaTags: ['acme/payments'] },
      { ref: PAYOUTS_REF, kind: 'prd', lastTouched: '', areaTags: ['acme/payments'] },
    ],
    areas: [
      {
        id: 'acme/payments',
        product: 'acme',
        concern: 'payments',
        docRefs: [REFUNDS_REF, PAYOUTS_REF],
        overlaps: [
          {
            docs: [REFUNDS_REF, PAYOUTS_REF],
            note: 'who owns the refund window',
            sections: [],
          },
        ],
      },
    ],
    relations: [],
    skippedDocs: [],
  },
  manualIncludes: [],
  manualExcludes: [],
  conflictResolutions: [],
};

const BODY = '# Refunds\n\nA refund settles within two business days.\n';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function serve(documents: ContextDocumentRow[] = [REFUNDS, LONELY]) {
  const calls: string[] = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    if (url.pathname === '/api/repos') return json([REPO_A, REPO_B]);
    if (url.pathname === '/api/llm/config') {
      return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    }
    if (url.pathname === '/api/sessions/runs') return json({ runs: [] });
    if (url.pathname === '/api/context/documents') return json({ documents, corpusAt: null });
    if (url.pathname === '/api/context/sources') return json({ sources: [], changedAt: null });
    if (url.pathname === '/api/context/staleness') {
      return json({ changedAt: null, corpusAt: null, stale: false });
    }
    if (url.pathname === '/api/context/corpus') return json(CORPUS);
    if (url.pathname === '/api/context/doc') {
      return json({ ref: url.searchParams.get('ref'), content: BODY });
    }
    // The repository half a document's coverage is read through.
    const repo = /^\/api\/repos\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (repo) {
      const rest = repo[2]!;
      if (rest === 'spec/corpus') return json(CORPUS);
      if (rest === 'spec/doc') return json({ ref: url.searchParams.get('ref'), content: BODY });
      if (rest === 'guard/claims') return json({ claims: [], untestable: [] });
      if (rest === 'guard/staleness') {
        return json({
          generateStale: false,
          runStale: false,
          hasCorpus: true,
          hasScenarios: true,
          hasGenerated: true,
          hasRun: true,
        });
      }
      if (rest === 'guard/coverage') {
        return json({
          doc: url.searchParams.get('doc'),
          markdown: true,
          sections: [
            {
              anchor: 'refunds',
              headingText: 'Refunds',
              level: 1,
              fingerprint: 'sha256:x',
              status: 'fail',
              flows: [],
              claimGaps: [],
              scenarioIds: [],
              scenarios: [],
            },
          ],
          orphanedSections: [],
          totals: {},
          runId: 'run-1',
          ranAt: '2026-09-02T00:00:00.000Z',
          generatedAt: '2026-09-02T00:00:00.000Z',
        });
      }
      if (rest === 'sessions/runs') return json({ runs: [] });
    }
    return json({ error: `not found: ${url.pathname}` }, 404);
  }) as unknown as typeof window.fetch;
  return calls;
}

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
    </MemoryRouter>,
  );
}

const docAt = (ref: string, query = '') =>
  `/preview/context/doc/${encodeURIComponent(ref)}${query}`;

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
  vi.restoreAllMocks();
});

describe('one document of Context', () => {
  it('opens the coverage page through the repository with the most to say', async () => {
    const calls = serve();
    renderAt(docAt(REFUNDS_REF));

    // The crumbs walk Context › the source › the document.
    const crumbs = await screen.findByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'Context' })).toBeInTheDocument();
    expect(within(crumbs).getByRole('link', { name: 'docs.acme.com' })).toHaveAttribute(
      'href',
      '/preview/context/documents?source=site-docs-acme',
    );
    expect(await screen.findByRole('heading', { name: 'Refunds' })).toBeInTheDocument();

    // The worst reading is the one it opened on: acme/api, which failed.
    await waitFor(() =>
      expect(calls.some((c) => c.startsWith(`/api/repos/${REPO_B.id}/guard/coverage`))).toBe(true),
    );
  });

  it('switches the reading to another repository, in the address', async () => {
    serve();
    renderAt(docAt(REFUNDS_REF));
    const user = userEvent.setup();

    const chips = await screen.findByRole('group', { name: 'Read through repository' });
    expect(within(chips).getByRole('button', { name: REPO_B.name })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(within(chips).getByRole('button', { name: REPO_A.name }));
    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent(`repo=${REPO_A.id}`),
    );
    expect(within(chips).getByRole('button', { name: REPO_A.name })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('offers no chips when one repository reads it', async () => {
    serve([{ ...REFUNDS, repositories: [REPO_A.name], readings: [{ repository: REPO_A.name, status: 'proved' }] }]);
    renderAt(docAt(REFUNDS_REF));

    await screen.findByRole('heading', { name: 'Refunds' });
    expect(screen.queryByRole('group', { name: 'Read through repository' })).toBeNull();
  });

  it('opens a document nothing reads as itself, with the repositories that could', async () => {
    const calls = serve();
    renderAt(docAt(LONELY_REF));

    expect(await screen.findByRole('heading', { name: 'Nobody reads this' })).toBeInTheDocument();
    expect(screen.getByText('Not linked')).toBeInTheDocument();
    // Its body, as the doc viewer renders one.
    expect(await screen.findByText('A refund settles within two business days.')).toBeInTheDocument();
    expect(calls).toContain(`/api/context/doc?ref=${encodeURIComponent(LONELY_REF)}`);
    // And where it could be linked.
    expect(screen.getByRole('link', { name: REPO_A.name })).toHaveAttribute(
      'href',
      `/preview/repos/${REPO_A.id}/context`,
    );
  });

  it('says so at an address this workspace has no document at', async () => {
    serve();
    renderAt(docAt('context/site-docs-acme/gone.md'));
    expect(await screen.findByText('No such document')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Context' })).toHaveAttribute(
      'href',
      '/preview/context',
    );
  });
});

describe('the conflicts of the workspace', () => {
  it('lists every conflict of the workspace corpus, open first', async () => {
    serve();
    renderAt('/preview/context/conflicts');

    const table = await screen.findByRole('table', { name: 'Conflicts' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('who owns the refund window')).toBeInTheDocument();
    expect(within(row).getByText('acme/payments')).toBeInTheDocument();
    expect(within(row).getByText('Open')).toBeInTheDocument();
    // A conflict belongs to the workspace: no repository column.
    expect(within(table).queryByRole('columnheader', { name: 'Repository' })).toBeNull();
  });

  it('opens the conflict with its resolver, on the workspace corpus', async () => {
    const calls = serve();
    renderAt('/preview/context/conflicts');
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Conflicts' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    await user.click(within(table).getAllByRole('row')[1]!);

    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent(
        '/preview/context/conflicts/overlap%3A%3A',
      ),
    );
    expect(
      await screen.findByRole('heading', { name: 'who owns the refund window' }),
    ).toBeInTheDocument();
    // The resolver read the WORKSPACE's documents, never a repository's.
    await waitFor(() =>
      expect(calls.some((c) => c.startsWith('/api/context/doc?ref='))).toBe(true),
    );
    expect(calls.some((c) => c.includes('/spec/doc?'))).toBe(false);
  });

  it('says so at an address the corpus has no conflict at', async () => {
    serve();
    renderAt('/preview/context/conflicts/overlap%3A%3Anope%3A%3Aa%3A%3Ab%3A%3A0000');
    expect((await screen.findAllByText('No such conflict')).length).toBeGreaterThan(0);
  });
});
