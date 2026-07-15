/**
 * The enterprise Knowledge page: the reused corpus components over a WORKSPACE
 * data source (`/api/ee/knowledge/spec/*`) instead of the repo routes.
 *   - Spec tab renders areas / kept docs / conflicts from the workspace corpus.
 *   - The "Not included" expander pages + searches via the paged skipped endpoint
 *     (the workspace corpus payload ships only a skipped SUMMARY).
 *   - Sources tab paginates + searches the provenance ledger; EmptyState before
 *     the first sync.
 * Backend stubbed at the fetch boundary (URL-routed, the house pattern).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// The Scenarios tab reads the org's live jobs (busy state) via the JobsContext.
// Mock it to a controllable activeJobs list — the Spec/Sources tabs don't use it,
// so the default (empty) leaves their tests unchanged.
const { jobsState } = vi.hoisted(() => ({
  jobsState: { activeJobs: [] as Array<{ type: string; id: string; key: string; status: string }> },
}));
vi.mock('../../ee/packages/client/src/jobs/JobsContext', () => ({
  __esModule: true,
  default: () => null,
  useJobs: () => ({
    activeJobs: jobsState.activeJobs,
    onJobSettled: () => () => {},
    notifications: [],
    unreadCount: 0,
    activeJobFor: () => undefined,
    markAllRead: async () => {},
    markRead: async () => {},
    refresh: async () => {},
  }),
}));

import KnowledgePage from '../../ee/packages/client/src/KnowledgePage';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A workspace corpus: two docs (one Confluence, one Jira) that conflict, plus a
 *  skipped SUMMARY of 120 dropped docs (no inline array — the workspace shape).
 *  The Confluence doc carries the ledger's read-time title + deep link; the Jira
 *  doc carries none, so it exercises the ref fallback in the same corpus. */
const WS_CORPUS = {
  corpus: {
    version: 1,
    generatedAt: '2026-07-01T00:00:00Z',
    docs: [
      { ref: 'knowledge/confluence/1.md', kind: 'confluence', lastTouched: '2026-06-01T00:00:00Z', areaTags: ['booking/appointments'], title: 'ADR 0002 — Error response envelope', url: 'https://acme.atlassian.net/wiki/1' },
      { ref: 'knowledge/jira/2.md', kind: 'jira', lastTouched: '2026-06-02T00:00:00Z', areaTags: ['booking/appointments'] },
    ],
    areas: [
      {
        id: 'booking/appointments',
        product: 'booking',
        concern: 'appointments',
        docRefs: ['knowledge/confluence/1.md', 'knowledge/jira/2.md'],
        overlaps: [
          {
            docs: ['knowledge/confluence/1.md', 'knowledge/jira/2.md'],
            note: 'ticket vs ADR disagree',
            sections: [
              { doc: 'knowledge/confluence/1.md', heading: 'Policy' },
              { doc: 'knowledge/jira/2.md', heading: 'Policy' },
            ],
          },
        ],
      },
    ],
    relations: [],
  },
  userRelations: [],
  skipped: { total: 120, byReason: [{ reason: 'low relevance', count: 120 }] },
};

/** A deterministic skipped page (the wire shape: `skipped`, not `docs`): 120 rows,
 *  filtered by `query` substring. Each row carries the ledger's read-time title +
 *  deep link, so the expander renders titles (not the synthetic refs). */
function skippedPage(query: string, limit: number, offset: number) {
  const all = Array.from({ length: 120 }, (_, i) => ({
    ref: `knowledge/jira/${i}.md`,
    reason: 'low relevance',
    title: `JIRA-${i}: flaky ticket ${i}`,
    url: `https://acme.atlassian.net/browse/JIRA-${i}`,
  }));
  const filtered = query ? all.filter((d) => d.ref.includes(query)) : all;
  return { skipped: filtered.slice(offset, offset + limit), total: filtered.length };
}

function paramOf(url: string, key: string): string {
  return new URL(url, 'http://localhost').searchParams.get(key) ?? '';
}

describe('KnowledgePage — Spec tab (workspace corpus)', () => {
  let calls: string[];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        calls.push(u);
        if (u.includes('/api/ee/knowledge/spec/corpus')) return json(WS_CORPUS);
        if (u.includes('/api/ee/knowledge/spec/skipped')) {
          const q = paramOf(u, 'query');
          const limit = Number(paramOf(u, 'limit'));
          const offset = Number(paramOf(u, 'offset'));
          return json(skippedPage(q, limit, offset));
        }
        if (u.includes('/api/ee/knowledge/spec/doc')) return json({ ref: 'knowledge/jira/2.md', content: '# Policy\n48h.' });
        if (u.includes('/api/ee/knowledge/documents')) return json({ documents: [], total: 0 });
        return json({});
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('renders kept docs by their ledger title (ref fallback) + the cross-source conflict', async () => {
    render(<KnowledgePage />);
    // The corpus GET hits the workspace spec route (not a repo route).
    await waitFor(() => expect(screen.getByText('Documents')).toBeInTheDocument());
    expect(calls.some((u) => u.includes('/api/ee/knowledge/spec/corpus'))).toBe(true);
    // The Confluence doc renders by its ledger title; the Jira doc (no title) falls
    // back to its synthetic ref — both in one corpus.
    expect(screen.getByText('ADR 0002 — Error response envelope')).toBeInTheDocument();
    expect(screen.getByText('knowledge/jira/2.md')).toBeInTheDocument();
    // The cross-source overlap surfaces as a conflict row, each side labeled by its
    // title when present (title ↔ ref-fallback).
    expect(
      screen.getByText('ADR 0002 — Error response envelope ↔ knowledge/jira/2.md'),
    ).toBeInTheDocument();
    // The titled doc carries the ledger's deep link (the Open-source affordance).
    const link = screen.getByRole('link', { name: 'Open source' });
    expect(link).toHaveAttribute('href', 'https://acme.atlassian.net/wiki/1');
  });

  it('opens a doc in the right pane via the workspace doc endpoint', async () => {
    const user = userEvent.setup();
    render(<KnowledgePage />);
    await screen.findByText('knowledge/jira/2.md');
    await user.click(screen.getByText('knowledge/jira/2.md'));
    expect(await screen.findByText('48h.')).toBeInTheDocument();
    expect(calls.some((u) => u.includes('/api/ee/knowledge/spec/doc?ref='))).toBe(true);
  });

  it('the "Not included" expander pages + searches via the paged skipped endpoint', async () => {
    const user = userEvent.setup();
    render(<KnowledgePage />);
    // Header shows the SUMMARY count, with no rows shipped in the corpus payload.
    const header = await screen.findByText('Not included');
    expect(within(header.closest('button')!).getByText('120')).toBeInTheDocument();
    expect(screen.queryByText('JIRA-0: flaky ticket 0')).not.toBeInTheDocument();

    // Expand → first page loads from the endpoint, rows shown by their ledger title.
    await user.click(header);
    expect(await screen.findByText('JIRA-0: flaky ticket 0')).toBeInTheDocument();
    expect(calls.some((u) => u.includes('/api/ee/knowledge/spec/skipped'))).toBe(true);

    // Load more → the next page appends.
    await user.click(screen.getByRole('button', { name: /Load more \(70 more\)/ }));
    expect(await screen.findByText('JIRA-50: flaky ticket 50')).toBeInTheDocument();

    // Search narrows to the one matching ref (offset resets; endpoint re-queried).
    await user.type(screen.getByPlaceholderText('Search not-included docs…'), 'jira/42');
    await waitFor(() =>
      expect(calls.some((u) => u.includes('/api/ee/knowledge/spec/skipped') && paramOf(u, 'query') === 'jira/42')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText('JIRA-0: flaky ticket 0')).not.toBeInTheDocument());
    expect(screen.getByText('JIRA-42: flaky ticket 42')).toBeInTheDocument();
  });

  it('force-include from the skipped expander records the workspace decision + moves the row out', async () => {
    const user = userEvent.setup();
    let includes: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        const method = init?.method ?? 'GET';
        if (u.includes('/api/ee/knowledge/spec/corpus')) return json(WS_CORPUS);
        if (u.includes('/api/ee/knowledge/spec/skipped')) {
          const q = paramOf(u, 'query');
          return json(skippedPage(q, Number(paramOf(u, 'limit')), Number(paramOf(u, 'offset'))));
        }
        if (u.includes('/api/ee/knowledge/spec/includes')) {
          const { ref } = JSON.parse(String(init?.body)) as { ref: string };
          includes = method === 'POST' ? [...includes, ref] : includes.filter((r) => r !== ref);
          return json({ manualIncludes: includes, manualExcludes: [] });
        }
        return json({});
      }),
    );
    render(<KnowledgePage />);
    await user.click(await screen.findByText('Not included'));
    await screen.findByText('JIRA-0: flaky ticket 0');
    // Include the first row → it leaves the skipped list and appears under Force-included.
    await user.click(within(screen.getByText('JIRA-0: flaky ticket 0').closest('[role="button"]')!).getByRole('button', { name: 'include' }));
    await screen.findByText('Force-included');
  });
});

describe('KnowledgePage — Sources tab (paginated ledger)', () => {
  function makeDocs(query: string, kind: string, limit: number, offset: number) {
    const all = [
      ...Array.from({ length: 80 }, (_, i) => ({ title: `ENG-${i}: story ${i}`, url: `https://acme.atlassian.net/browse/ENG-${i}`, sourceKind: 'jira', externalId: `${i}`, lastSyncedAt: '2026-07-07T00:00:00Z' })),
      ...Array.from({ length: 40 }, (_, i) => ({ title: `Confluence page ${i}`, url: `https://acme.atlassian.net/wiki/${i}`, sourceKind: 'confluence', externalId: `c${i}`, lastSyncedAt: '2026-07-07T00:00:00Z' })),
    ];
    let filtered = all;
    if (kind) filtered = filtered.filter((d) => d.sourceKind === kind);
    if (query) filtered = filtered.filter((d) => d.title.includes(query));
    return { documents: filtered.slice(offset, offset + limit), total: filtered.length };
  }

  afterEach(() => vi.unstubAllGlobals());

  it('shows the connect EmptyState before the first sync (no docs)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/api/ee/knowledge/spec/corpus')) return json({}, 404);
        if (u.includes('/api/ee/knowledge/documents')) return json({ documents: [], total: 0 });
        return json({});
      }),
    );
    const user = userEvent.setup();
    render(<KnowledgePage />);
    await user.click(await screen.findByRole('button', { name: /Sources/ }));
    expect(await screen.findByText('No sources yet')).toBeInTheDocument();
    // Sources fills after Sync (not Process) now.
    expect(screen.getByText('Connect a source and sync to see its documents here.')).toBeInTheDocument();
  });

  it('paginates + searches + kind-filters the ledger via the paged documents endpoint', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        calls.push(u);
        if (u.includes('/api/ee/knowledge/spec/corpus')) return json({}, 404);
        if (u.includes('/api/ee/knowledge/documents')) {
          return json(makeDocs(paramOf(u, 'query'), paramOf(u, 'kind'), Number(paramOf(u, 'limit')), Number(paramOf(u, 'offset'))));
        }
        return json({});
      }),
    );
    const user = userEvent.setup();
    render(<KnowledgePage />);
    await user.click(await screen.findByRole('button', { name: /Sources/ }));

    // First page (50 of 120) + a "Load more" affordance.
    expect(await screen.findByText('ENG-0: story 0')).toBeInTheDocument();
    const loadMore = await screen.findByRole('button', { name: /Load more \(70 more\)/ });
    await user.click(loadMore);
    expect(await screen.findByText('ENG-50: story 50')).toBeInTheDocument();

    // Search re-queries from offset 0.
    await user.type(screen.getByPlaceholderText('Search documents…'), 'story 42');
    await waitFor(() =>
      expect(calls.some((u) => u.includes('/api/ee/knowledge/documents') && paramOf(u, 'query') === 'story 42')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText('ENG-0: story 0')).not.toBeInTheDocument());

    // Jira rows carry the deep link the ledger stores.
    const link = screen.getByRole('link', { name: 'ENG-42: story 42' });
    expect(link).toHaveAttribute('href', 'https://acme.atlassian.net/browse/ENG-42');
  });
});

describe('KnowledgePage — Scenarios tab (workspace guard)', () => {
  // A clean, conflict-free corpus (empty overlaps → the Generate flow is enabled).
  const CLEAN_CORPUS = {
    corpus: {
      version: 1,
      generatedAt: '2026-07-01T00:00:00Z',
      docs: [{ ref: 'knowledge/confluence/1.md', kind: 'spec', lastTouched: '2026-06-01T00:00:00Z', areaTags: ['core/checkout'] }],
      areas: [{ id: 'core/checkout', product: 'core', concern: 'checkout', docRefs: ['knowledge/confluence/1.md'], overlaps: [] }],
      relations: [],
    },
    userRelations: [],
    manualExcludes: [],
    conflictResolutions: [],
    skipped: { total: 0, byReason: [] },
  };

  const REPORT = {
    status: 'ok',
    generatedAt: '2026-07-14T12:00:00Z',
    sectionsTotal: 1,
    sectionsChanged: 1,
    skippedUnchanged: 0,
    noChanges: false,
    written: [{ id: 's1', title: 'checkout totals in cents', doc: 'knowledge/confluence/1.md', anchor: 'intro', file: '.truecourse/scenarios/core/s1.yaml' }],
    coverageGaps: [],
    birthFindings: [],
    errors: [],
    extractionFailures: [],
    orphaned: [],
    birthPassed: 1,
    heldSections: [],
    orphanedDismissals: [],
  };
  const COVERAGE = {
    report: REPORT,
    recipe: null,
    scenarios: [{ id: 's1', title: 'checkout totals in cents', doc: 'knowledge/confluence/1.md', anchor: 'intro', file: '.truecourse/scenarios/core/s1.yaml', handWritten: false }],
    hasGenerated: true,
    hasScenarios: true,
  };
  const EMPTY_COVERAGE = { report: null, recipe: null, scenarios: [], hasGenerated: false, hasScenarios: false };

  afterEach(() => {
    vi.unstubAllGlobals();
    jobsState.activeJobs = [];
  });

  async function openScenarios() {
    const user = userEvent.setup();
    render(<KnowledgePage />);
    await user.click(await screen.findByRole('button', { name: /Scenarios/ }));
    return user;
  }

  it('renders the generated scenarios coverage (overview + inventory)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/coverage')) return json(COVERAGE);
        if (u.includes('/spec/corpus')) return json(CLEAN_CORPUS);
        return json({ documents: [], total: 0 });
      }),
    );
    await openScenarios();
    // The overview shows the last-generate strip; the inventory shows the scenario.
    expect(await screen.findByText('Last generate')).toBeInTheDocument();
    expect(screen.getAllByText('checkout totals in cents').length).toBeGreaterThan(0);
  });

  it('renders no Generate button and the auto-generation EmptyState before the first generate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/coverage')) return json(EMPTY_COVERAGE);
        if (u.includes('/spec/corpus')) return json(CLEAN_CORPUS);
        return json({ documents: [], total: 0 });
      }),
    );
    await openScenarios();

    // Generation auto-chains off a conflict-free Process — the tab has no Generate
    // action; the EmptyState tells the user scenarios generate automatically.
    expect(await screen.findByText('No scenarios yet')).toBeInTheDocument();
    expect(
      screen.getByText(/Scenarios are generated automatically when Knowledge is processed/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument();
  });

  it('shows the blocked panel while a spec conflict is open (no Generate button)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/coverage')) return json(EMPTY_COVERAGE);
        if (u.includes('/spec/corpus')) return json(WS_CORPUS); // carries one unresolved overlap
        return json({ documents: [], total: 0 });
      }),
    );
    await openScenarios();
    expect(await screen.findByText('Scenario generation is blocked')).toBeInTheDocument();
    // The conflicting doc pair is listed for resolution.
    expect(
      screen.getByText('knowledge/confluence/1.md ↔ knowledge/jira/2.md'),
    ).toBeInTheDocument();
    // Generation is automatic — there is no Generate/Regenerate action on the tab.
    expect(screen.queryByRole('button', { name: /Generate/ })).not.toBeInTheDocument();
  });

  it('shows the "Generating…" affordance while a workspace guard job is active', async () => {
    jobsState.activeJobs = [{ type: 'knowledge.guard', id: 'j1', key: 'knowledge.guard:org', status: 'running' }];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/coverage')) return json(EMPTY_COVERAGE);
        if (u.includes('/spec/corpus')) return json(CLEAN_CORPUS);
        return json({ documents: [], total: 0 });
      }),
    );
    await openScenarios();
    // A non-button affordance — generation is automatic, there is no Generate action.
    expect(await screen.findByText('Generating…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Generat/ })).not.toBeInTheDocument();
  });
});
