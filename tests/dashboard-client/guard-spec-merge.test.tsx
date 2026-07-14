/**
 * The Guard Coverage tab absorbing the BL-Drift spec surface (no separate Spec
 * tab). Two seams are exercised:
 *
 *  1. The reused SpecCorpusView as Guard's coverage SIDEBAR — same component,
 *     routed through Guard's OWN selection slice (`?guard` for a doc, `?gconf` for
 *     a conflict). Docs + tags + conflicts + skipped docs render; a doc/conflict
 *     click writes guard params and never `?spec=` (no bleed into BL Drift); the
 *     force-include/exclude decision endpoints fire.
 *  2. GuardCoveragePage's detail pane multiplexing scenario detail | overlap
 *     detail — a `?gconf` deep link opens the five-option SpecOverlapDetail;
 *     resolving optimistically refreshes the corpus; a resolved conflict is
 *     change/revoke-able; and a conflicted heading on the coverage doc carries a
 *     "conflict" tag that opens the resolution detail.
 *
 * Fetches are stubbed the house way (`vi.stubGlobal('fetch', …)`); components
 * mount under a MemoryRouter since selection lives in the URL.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type {
  GuardDocCoverage,
  GuardSectionCoverage,
  GuardSectionCoverageStatus,
  GuardStaleness,
} from '@truecourse/shared';
import {
  SpecCorpusView,
  overlapKey,
  type SpecCorpusState,
} from '@/components/spec/SpecCorpusView';
import type { SpecCorpusResponse } from '@/lib/api';
import { GuardCoveragePage } from '@/components/guard/GuardCoveragePage';
import { useGuardCoverageTabs } from '@/hooks/useGuardCoverageTabs';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const OVERLAP_KEY = overlapKey('core/auth', 'docs/SPEC.md', 'docs/OTHER.md');

const CORPUS_RESP: SpecCorpusResponse = {
  corpus: {
    version: 1,
    generatedAt: '',
    docs: [
      { ref: 'docs/SPEC.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['core/auth'] },
      { ref: 'docs/OTHER.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/auth'] },
    ],
    areas: [
      {
        id: 'core/auth',
        product: 'core',
        concern: 'auth',
        docRefs: ['docs/SPEC.md', 'docs/OTHER.md'],
        overlaps: [
          {
            docs: ['docs/SPEC.md', 'docs/OTHER.md'],
            note: 'they disagree on rate limits',
            sections: [
              { doc: 'docs/SPEC.md', heading: 'Failing bit' },
              { doc: 'docs/OTHER.md', heading: 'Failing bit' },
            ],
          },
        ],
      },
    ],
    relations: [],
    skippedDocs: [{ ref: 'docs/DROPPED.md', reason: 'low relevance' }],
  },
  userRelations: [],
};

const RESOLVED_RESP: SpecCorpusResponse = {
  ...CORPUS_RESP,
  userRelations: [
    { type: 'precedence', older: 'docs/OTHER.md', newer: 'docs/SPEC.md', scope: 'core/auth', detectedFrom: 'manual' },
  ],
};

function corpusState(over: Partial<SpecCorpusState> = {}): SpecCorpusState {
  return {
    data: CORPUS_RESP,
    hydrating: false,
    scanning: false,
    error: null,
    corpusCommit: null,
    scan: vi.fn(),
    refetch: vi.fn(),
    apply: vi.fn(),
    applyDecisions: vi.fn(),
    applyConflictResolutions: vi.fn(),
    ...over,
  };
}

// --- coverage fixture (for the conflict-mark test on the doc surface) ----------
const MD = ['# Doc', 'intro', '', '## Failing bit', 'a rate-limit claim', '', '## Passing bit', 'ok'].join('\n');

function sec(headingText: string, level: number, status: GuardSectionCoverageStatus): GuardSectionCoverage {
  return {
    anchor: headingText.toLowerCase().replace(/\s+/g, '-'),
    headingText,
    level,
    fingerprint: 'sha256:x',
    status,
    scenarioIds: [],
    scenarios: [],
  };
}

const TOTALS = {
  pass: 1, fail: 1, error: 0, stale: 0, orphaned: 0, guarded: 0, api: 0, web: 0, tui: 0,
  'blocked-on': 0, untestable: 0, 'no-claim': 1, unguarded: 0,
} as Record<GuardSectionCoverageStatus, number>;

const COVERAGE: GuardDocCoverage = {
  doc: 'docs/SPEC.md',
  markdown: true,
  sections: [sec('Doc', 1, 'no-claim'), sec('Failing bit', 2, 'fail'), sec('Passing bit', 2, 'pass')],
  orphanedSections: [],
  totals: TOTALS,
  runId: 'run1',
  ranAt: '2026-07-07T00:00:00Z',
  generatedAt: '2026-07-07T00:00:00Z',
};

const ALL_TRUE: GuardStaleness = {
  generateStale: false, runStale: false, hasCorpus: true, hasScenarios: true, hasGenerated: true, hasRun: true,
};

// LocationProbe surfaces the live query string so URL writes can be asserted.
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="search">{loc.search}</span>;
}

// The exact wiring RepoPage uses for the Guard coverage sidebar: the reused
// SpecCorpusView routed through the shared preview/pin tab reducer.
function GuardSidebar({ corpus }: { corpus: SpecCorpusState }) {
  const tabs = useGuardCoverageTabs('r1');
  return (
    <>
      <SpecCorpusView repoId="r1" corpus={corpus} activeKey={tabs.activeId} onOpen={tabs.open} />
      <LocationProbe />
    </>
  );
}

// -----------------------------------------------------------------------------

describe('Guard coverage sidebar (reused SpecCorpusView)', () => {
  it('renders docs + tags + conflicts + skipped docs in the guard context', async () => {
    render(
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=coverage']}>
        <GuardSidebar corpus={corpusState()} />
      </MemoryRouter>,
    );
    // Documents + their area tag (single product → concern only).
    expect(screen.getByText('Documents')).toBeInTheDocument();
    expect(screen.getByText('docs/SPEC.md')).toBeInTheDocument();
    expect(screen.getByText('docs/OTHER.md')).toBeInTheDocument();
    expect(screen.getAllByText('auth').length).toBeGreaterThan(0);
    // Conflicts.
    expect(screen.getByText('Conflicts')).toBeInTheDocument();
    expect(screen.getByText('docs/SPEC.md ↔ docs/OTHER.md')).toBeInTheDocument();
    // Skipped ("Not included") docs — the section starts collapsed; expand to see rows.
    expect(screen.getByText('Not included')).toBeInTheDocument();
    expect(screen.queryByText('docs/DROPPED.md')).not.toBeInTheDocument();
    await userEvent.setup().click(screen.getByText('Not included'));
    expect(screen.getByText('docs/DROPPED.md')).toBeInTheDocument();
  });

  it('a doc click routes to ?guard= and never ?spec= (no BL-Drift bleed)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=coverage']}>
        <GuardSidebar corpus={corpusState()} />
      </MemoryRouter>,
    );
    await user.click(screen.getByText('docs/SPEC.md'));
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('guard=docs%2FSPEC.md');
    expect(search).not.toContain('spec=');
  });

  it('a conflict click routes to ?gconf= and never ?spec= (no BL-Drift bleed)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=coverage']}>
        <GuardSidebar corpus={corpusState()} />
      </MemoryRouter>,
    );
    await user.click(screen.getByText('docs/SPEC.md ↔ docs/OTHER.md'));
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('gconf=');
    expect(decodeURIComponent(search)).toContain(OVERLAP_KEY);
    expect(search).not.toContain('spec=');
  });

  it('force-excluding a doc from guard fires the excludes endpoint', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return json(CORPUS_RESP);
      }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=coverage']}>
        <GuardSidebar corpus={corpusState()} />
      </MemoryRouter>,
    );
    await user.click(screen.getAllByRole('button', { name: 'skip' })[0]);
    await waitFor(() => expect(calls.some((u) => u.includes('/spec/excludes'))).toBe(true));
    vi.unstubAllGlobals();
  });

  it('force-including a skipped doc from guard fires the includes endpoint', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        calls.push(String(url));
        return json(CORPUS_RESP);
      }),
    );
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=coverage']}>
        <GuardSidebar corpus={corpusState()} />
      </MemoryRouter>,
    );
    await user.click(screen.getByText('Not included')); // expand the collapsed section
    await user.click(screen.getByRole('button', { name: 'include' }));
    await waitFor(() => expect(calls.some((u) => u.includes('/spec/includes'))).toBe(true));
    vi.unstubAllGlobals();
  });
});

describe('Guard coverage — conflict resolution in the detail pane', () => {
  let lastConflictPost: Record<string, unknown> | null;
  beforeEach(() => {
    lastConflictPost = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, opts?: RequestInit) => {
        const u = String(url);
        if (u.includes('/spec/conflict-resolution')) {
          if (opts?.method === 'POST') lastConflictPost = JSON.parse(String(opts.body));
          return json({ conflictResolutions: [] });
        }
        if (u.includes('/spec/relations')) return json({ relations: [] });
        if (u.includes('/guard/coverage')) return json(COVERAGE);
        if (u.includes('/spec/doc')) return json({ ref: 'docs/SPEC.md', content: MD });
        return json({});
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  // Mirrors RepoPage: the coverage main pane driven by the shared tab reducer.
  function CoveragePane({ corpus, staleness }: { corpus: SpecCorpusState; staleness: GuardStaleness }) {
    const tabs = useGuardCoverageTabs('r1');
    return <GuardCoveragePage repoId="r1" corpus={corpus} staleness={staleness} staleLoaded tabs={tabs} />;
  }

  function renderCoverage(corpus: SpecCorpusState, url: string, staleness: GuardStaleness = ALL_TRUE) {
    return render(
      <MemoryRouter initialEntries={[url]}>
        <CoveragePane corpus={corpus} staleness={staleness} />
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  it('a ?gconf deep link opens the three verdicts (no relation buttons)', async () => {
    renderCoverage(corpusState(), `/repos/r?section=guard&tab=coverage&gconf=${encodeURIComponent(OVERLAP_KEY)}`);
    expect(await screen.findByRole('button', { name: 'docs/SPEC.md is right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'docs/OTHER.md is right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not a real conflict' })).toBeInTheDocument();
    for (const label of ['Use newer only', 'Prefer newer', 'Keep both']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getByText('they disagree on rate limits')).toBeInTheDocument();
  });

  it('a verdict records the resolution (optimistic ack → corpus updated in place)', async () => {
    const applyConflictResolutions = vi.fn();
    const corpus = corpusState({ applyConflictResolutions });
    const user = userEvent.setup();
    renderCoverage(corpus, `/repos/r?section=guard&tab=coverage&gconf=${encodeURIComponent(OVERLAP_KEY)}`);
    await user.click(await screen.findByRole('button', { name: 'docs/SPEC.md is right' }));
    // OSS ack → the page updates the verdict list in place (no re-curate/refetch).
    await waitFor(() => expect(applyConflictResolutions).toHaveBeenCalled());
    expect(lastConflictPost).toMatchObject({ docA: 'docs/SPEC.md', docB: 'docs/OTHER.md', verdict: 'a' });
  });

  it('a covering doc-relation does NOT resolve — the verdict actions still render', async () => {
    renderCoverage(corpusState({ data: RESOLVED_RESP }), `/repos/r?section=guard&tab=coverage&gconf=${encodeURIComponent(OVERLAP_KEY)}`);
    expect(await screen.findByRole('button', { name: 'docs/SPEC.md is right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not a real conflict' })).toBeInTheDocument();
    expect(screen.queryByText(/Resolved →/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('closing the overlap detail clears ?gconf', async () => {
    const user = userEvent.setup();
    renderCoverage(corpusState(), `/repos/r?section=guard&tab=coverage&gconf=${encodeURIComponent(OVERLAP_KEY)}`);
    await user.click(await screen.findByRole('button', { name: 'Close conflict detail' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent ?? '').not.toContain('gconf='));
  });

  it('marks a conflicted heading on the coverage doc and opens its resolution on click', async () => {
    const user = userEvent.setup();
    renderCoverage(corpusState(), '/repos/r?section=guard&tab=coverage&guard=docs%2FSPEC.md');
    // The "Failing bit" heading is flagged by the overlap → a conflict tag renders.
    const tag = await screen.findByText('conflict');
    expect(tag).toBeInTheDocument();
    await user.click(tag);
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('gconf=');
    expect(decodeURIComponent(search)).toContain(OVERLAP_KEY);
    expect(search).not.toContain('spec=');
  });
});
