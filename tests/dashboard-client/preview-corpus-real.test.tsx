/**
 * The Corpus tab of a CONNECTED repository reads the server, not the fixtures:
 * the documents and conflicts of the stored corpus, each document's rollup
 * from the real scenario inventory, a document's body from the doc route, and
 * an honest empty state while no scan has written a corpus yet.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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

const REAL = {
  id: 'linkwarden',
  name: 'linkwarden/linkwarden',
  path: 'linkwarden/linkwarden',
  remoteUrl: 'https://github.com/linkwarden/linkwarden',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A stored corpus: two documents in one area, one open overlap between them. */
const CORPUS = {
  corpus: {
    version: 3,
    generatedAt: '2026-08-30T10:00:00.000Z',
    docs: [
      { ref: 'docs/links.md', kind: 'prd', lastTouched: '2026-08-29T10:00:00.000Z', areaTags: ['linkwarden/links'] },
      { ref: 'docs/collections.md', kind: 'prd', lastTouched: '2026-08-28T10:00:00.000Z', areaTags: ['linkwarden/links'] },
    ],
    areas: [
      {
        id: 'linkwarden/links',
        product: 'linkwarden',
        concern: 'links',
        docRefs: ['docs/links.md', 'docs/collections.md'],
        overlaps: [{ docs: ['docs/links.md', 'docs/collections.md'], note: 'who owns a shared link', sections: [] }],
      },
    ],
    relations: [],
    skippedDocs: [],
  },
  manualIncludes: [],
  manualExcludes: [],
  conflictResolutions: [],
};

const SCENARIOS = {
  recipe: null,
  scenarios: [
    { id: 's1', title: 'add a link', doc: 'docs/links.md', anchor: 'adding', file: 'a.yaml', handWritten: false, flowId: 'f1', status: 'passing' },
    { id: 's2', title: 'tag a link', doc: 'docs/links.md', anchor: 'tagging', file: 'b.yaml', handWritten: false, flowId: 'f1', status: 'failing' },
  ],
};

const STALENESS = { generateStale: false, runStale: false, hasCorpus: true, hasScenarios: true, hasGenerated: true, hasRun: false };

/** A world: one connected repository and what its server holds. */
function serve(options: { corpus?: unknown; corpusStatus?: number } = {}) {
  const calls: string[] = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    const rest = url.pathname.replace(`/api/repos/${REAL.id}/`, '');
    if (url.pathname === '/api/repos') return json([REAL]);
    if (url.pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (rest === 'sessions/runs') return json({ runs: [] });
    if (rest === 'spec/corpus') return json(options.corpus ?? CORPUS, options.corpusStatus ?? 200);
    if (rest === 'guard/scenarios') return json(SCENARIOS);
    if (rest === 'guard/latest') return json({ latest: null, pending: null });
    if (rest === 'guard/staleness') return json(STALENESS);
    if (rest === 'spec/doc') {
      const ref = url.searchParams.get('ref') ?? '';
      return ref === 'docs/links.md'
        ? json({ ref, content: '# Links\n\n## Adding\n\nA link is saved with its title.\n' })
        : json({ error: `Doc not found: ${ref}` }, 404);
    }
    if (rest === 'guard/coverage') {
      return json({ doc: 'docs/links.md', markdown: true, sections: [], orphanedSections: [], totals: {}, runId: null, ranAt: null, generatedAt: null });
    }
    return json({ error: `not found: ${rest}` }, 404);
  }) as unknown as typeof window.fetch;
  return calls;
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

const CORPUS_TAB = `/preview/repos/${REAL.id}/corpus`;

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('the Corpus tab of a connected repository', () => {
  it('lists the stored corpus: its documents, their rollups and the open conflict', async () => {
    const calls = serve();
    renderAt(CORPUS_TAB);

    const table = await screen.findByRole('table', { name: 'Spec corpus' });
    await within(table).findByText('docs/links.md');
    expect(within(table).getByText('docs/collections.md')).toBeInTheDocument();
    // The conflict row, open, named by its note.
    expect(within(table).getByText('who owns a shared link')).toBeInTheDocument();
    expect(within(table).getByText('Open')).toBeInTheDocument();
    // links.md: two scenarios bound to two sections, one of them failing.
    const links = within(table).getByText('docs/links.md').closest('tr')!;
    await within(links).findByText('Failing');
    // Two sections bound, two scenarios proving them.
    expect(within(links).getAllByText('2', { selector: 'td' })).toHaveLength(2);
    // collections.md has nothing bound yet.
    const collections = within(table).getByText('docs/collections.md').closest('tr')!;
    expect(within(collections).getByText('Never run')).toBeInTheDocument();

    expect(calls).toContain(`/api/repos/${REAL.id}/spec/corpus`);
    expect(calls).toContain(`/api/repos/${REAL.id}/guard/scenarios`);
  });

  it('opens a document from the server, as its own page', async () => {
    const calls = serve();
    renderAt(CORPUS_TAB);
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Spec corpus' });
    await user.click(await within(table).findByText('docs/links.md'));

    await waitFor(() => expect(calls).toContain(`/api/repos/${REAL.id}/spec/doc?ref=docs%2Flinks.md`));
    await screen.findByText('A link is saved with its title.', { exact: false });
    expect(screen.getByRole('heading', { name: 'docs/links.md' })).toBeInTheDocument();
  });

  it('says so, honestly, while no scan has written a corpus', async () => {
    serve({ corpus: { error: 'No corpus' }, corpusStatus: 404 });
    renderAt(CORPUS_TAB);

    await screen.findByText(/No corpus yet/);
  });
});
