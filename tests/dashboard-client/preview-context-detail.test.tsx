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
import { Toaster } from 'sonner';
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

import DashboardApp from '@/dashboard/DashboardApp';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = (() => {}) as Element['scrollIntoView'];
}

const realFetch = window.fetch;

const REPO_A = { id: 'web', name: 'acme/web', path: 'acme/web', provider: 'github' };
const REPO_B = { id: 'api', name: 'acme/api', path: 'acme/api', provider: 'github' };

const REFUNDS_REF = 'context/site-docs-acme/refunds.md';
const PAYOUTS_REF = 'context/site-docs-acme/payouts.md';
const LONELY_REF = 'context/site-docs-acme/lonely.md';
const CHANGELOG_REF = 'context/site-docs-acme/changelog.md';
const LEGACY_REF = 'context/site-docs-acme/legacy.md';

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
  inCorpus: true,
  decision: null,
  inclusion: 'in-corpus',
  skipReason: null,
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
  inCorpus: true,
  decision: null,
  inclusion: 'in-corpus',
  skipReason: null,
  updatedAt: '2026-09-01T10:00:00.000Z',
};

/** A document the scan left out, with the words it left it out in. */
const CHANGELOG: ContextDocumentRow = {
  ref: CHANGELOG_REF,
  title: 'Changelog',
  area: '',
  sourceId: 'site-docs-acme',
  sourceTitle: 'docs.acme.com',
  sourceKind: 'site',
  repositories: [],
  readings: [],
  status: null,
  inCorpus: false,
  decision: null,
  inclusion: 'not-included',
  skipReason: 'a changelog, not a specification',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

/** One a reader dropped, which a scan has since applied. */
const LEGACY: ContextDocumentRow = {
  ...CHANGELOG,
  ref: LEGACY_REF,
  title: 'Legacy',
  decision: 'exclude',
  inclusion: 'excluded',
  skipReason: null,
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

/** Every write of a run, with the document it named: the decisions' own record. */
let writes: { path: string; method: string; ref: unknown }[] = [];

function serve(documents: ContextDocumentRow[] = [REFUNDS, LONELY]) {
  const calls: string[] = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    if (method !== 'GET') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      writes.push({ path: url.pathname, method, ref: body.ref });
    }
    if (url.pathname === '/api/context/includes' || url.pathname === '/api/context/excludes') {
      return json({ manualIncludes: [], manualExcludes: [] });
    }
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
        <Route path="/*" element={<DashboardApp />} />
      </Routes>
      <Address />
      <Toaster />
    </MemoryRouter>,
  );
}

const docAt = (ref: string, query = '') =>
  `/context/doc/${encodeURIComponent(ref)}${query}`;

beforeEach(() => {
  window.history.replaceState({}, '', '/');
  writes = [];
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
      '/context/documents?source=site-docs-acme',
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
      `/repos/${REPO_A.id}/context`,
    );
  });

  it('says so at an address this workspace has no document at', async () => {
    serve();
    renderAt(docAt('context/site-docs-acme/gone.md'));
    expect(await screen.findByText('No such document')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Context' })).toHaveAttribute(
      'href',
      '/context',
    );
  });
});

/**
 * The document's own page is where a document is included or excluded, because
 * it is where a reader can see what they are deciding about. One action, in the
 * header where the document's name is, writing the WORKSPACE's decisions — and
 * saying what the next scan will do with them, because until then nothing has
 * changed.
 */
describe('deciding a document in or out', () => {
  const world = [REFUNDS, LONELY, CHANGELOG, LEGACY];

  it('opens a document the corpus does not hold, with the scan’s own reason', async () => {
    serve(world);
    renderAt(docAt(CHANGELOG_REF));

    expect(await screen.findByRole('heading', { name: 'Changelog' })).toBeInTheDocument();
    expect(screen.getByText('Not included')).toBeInTheDocument();
    expect(screen.getByText('a changelog, not a specification')).toBeInTheDocument();
    expect(await screen.findByText('A refund settles within two business days.')).toBeInTheDocument();
    // Nothing can prove a document the corpus does not hold, so nothing offers to.
    expect(screen.queryByText(/to have it proven/)).toBeNull();
  });

  it('includes the one the scan skipped, and says the next scan applies it', async () => {
    serve(world);
    renderAt(docAt(CHANGELOG_REF));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Include' }));

    await waitFor(() =>
      expect(writes).toContainEqual({
        path: '/api/context/includes',
        method: 'POST',
        ref: CHANGELOG_REF,
      }),
    );
    expect(
      await screen.findByText('Included. The next scan adds it to the corpus.'),
    ).toBeInTheDocument();
    // The row moves now: the decision stands, and the corpus is behind it.
    expect(await screen.findByText('Included at the next scan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo include' })).toBeInTheDocument();
  });

  it('takes an include back', async () => {
    serve([REFUNDS, LONELY, { ...CHANGELOG, decision: 'include' }, LEGACY]);
    renderAt(docAt(CHANGELOG_REF));
    const user = userEvent.setup();

    expect(await screen.findByText('Included at the next scan')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo include' }));

    await waitFor(() =>
      expect(writes).toContainEqual({
        path: '/api/context/includes',
        method: 'DELETE',
        ref: CHANGELOG_REF,
      }),
    );
    expect(
      await screen.findByText('Include undone. The next scan decides again.'),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Include' })).toBeInTheDocument();
  });

  it('excludes a document the corpus holds, which keeps its coverage until a scan', async () => {
    serve(world);
    renderAt(docAt(LONELY_REF));
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Exclude' }));

    await waitFor(() =>
      expect(writes).toContainEqual({
        path: '/api/context/excludes',
        method: 'POST',
        ref: LONELY_REF,
      }),
    );
    expect(
      await screen.findByText('Excluded. The next scan drops it from the corpus.'),
    ).toBeInTheDocument();
    expect(await screen.findByText('Excluded at the next scan')).toBeInTheDocument();
    expect(screen.getByText('Not linked')).toBeInTheDocument();
  });

  it('takes an exclusion back', async () => {
    serve(world);
    renderAt(docAt(LEGACY_REF));
    const user = userEvent.setup();

    expect(await screen.findByText('Excluded')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo exclude' }));

    await waitFor(() =>
      expect(writes).toContainEqual({
        path: '/api/context/excludes',
        method: 'DELETE',
        ref: LEGACY_REF,
      }),
    );
    expect(
      await screen.findByText('Exclusion undone. The next scan decides again.'),
    ).toBeInTheDocument();
    // Back to a document the corpus simply does not hold.
    expect(await screen.findByRole('button', { name: 'Include' })).toBeInTheDocument();
    expect(screen.getByText('Not included')).toBeInTheDocument();
  });
});

describe('the conflicts of the workspace', () => {
  it('lists every conflict of the workspace corpus, open first', async () => {
    serve();
    renderAt('/context/conflicts');

    const table = await screen.findByRole('table', { name: 'Conflicts' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    const row = within(table).getAllByRole('row')[1]!;
    expect(within(row).getByText('who owns the refund window')).toBeInTheDocument();
    expect(within(row).getByText('acme/payments')).toBeInTheDocument();
    expect(within(row).getByText('Open')).toBeInTheDocument();
    // A conflict belongs to the workspace: no repository column.
    expect(within(table).queryByRole('columnheader', { name: 'Repository' })).toBeNull();
    // How many of each the list shows is its last line.
    expect(screen.getByRole('group', { name: 'Conflicts tally' }).textContent).toBe('1 Open1 total');
  });

  it('opens the conflict with its resolver, on the workspace corpus', async () => {
    const calls = serve();
    renderAt('/context/conflicts');
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Conflicts' });
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(2));
    await user.click(within(table).getAllByRole('row')[1]!);

    await waitFor(() =>
      expect(screen.getByTestId('address')).toHaveTextContent(
        '/context/conflicts/overlap%3A%3A',
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
    renderAt('/context/conflicts/overlap%3A%3Anope%3A%3Aa%3A%3Ab%3A%3A0000');
    expect((await screen.findAllByText('No such conflict')).length).toBeGreaterThan(0);
  });
});
