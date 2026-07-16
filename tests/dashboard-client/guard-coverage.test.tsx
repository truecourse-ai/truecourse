/**
 * Guard coverage view tests: the onboarding empty states (now the Overview
 * pane, shown when no item tab is open), coverage rendering with per-status
 * treatments, the filtering totals strip (incl. the blocked-on chip expanding to
 * the capability breakdown moved from the Report tab), section → scenario detail,
 * the evidence transcript fetch, and the shared preview/pin TAB model (doc tabs
 * and conflict tabs, the same GuardTabStrip idiom as Scenarios/Runs). Fetches are
 * stubbed the house way (`vi.stubGlobal('fetch', …)` routed by URL); the pane is
 * mounted under a MemoryRouter reading `?guard`/`?gconf`/`?gsec`, with the sidebar
 * (reused SpecCorpusView) sharing the ONE tab reducer via `useGuardCoverageTabs`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type {
  GuardDocCoverage,
  GuardSectionCoverage,
  GuardSectionCoverageStatus,
  GuardStaleness,
} from '@truecourse/shared';
import { SpecCorpusView, overlapKey, type SpecCorpusState } from '@/components/spec/SpecCorpusView';
import { GuardCoveragePage } from '@/components/guard/GuardCoveragePage';
import { useGuardCoverageTabs } from '@/hooks/useGuardCoverageTabs';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const MD = [
  '# Guard Spec',
  'Intro paragraph.',
  '',
  '## Failing bit',
  'Rate limit claim.',
  '',
  '## Passing bit',
  'Passes.',
  '',
  '## Stale bit',
  'Edited since generation.',
  '',
  '## Guarded bit',
  'Bound, not run.',
  '',
  '## Blocked bit',
  'Needs a database.',
  '',
  '## Web bit',
  'HTTP boundary.',
  '',
  '## Untestable bit',
  'Nothing assertable.',
  '',
  '## Dismissed bit',
  'Dismissed by decision.',
  '',
  '## Unguarded bit',
  'Nothing binds here.',
].join('\n');

function sec(
  headingText: string,
  level: number,
  status: GuardSectionCoverageStatus,
  extra: Partial<GuardSectionCoverage> = {},
): GuardSectionCoverage {
  return {
    anchor: headingText.toLowerCase().replace(/\s+/g, '-'),
    headingText,
    level,
    fingerprint: 'sha256:x',
    status,
    scenarioIds: [],
    scenarios: [],
    ...extra,
  };
}

const SECTIONS: GuardSectionCoverage[] = [
  sec('Guard Spec', 1, 'no-claim', { reason: 'overview' }),
  sec('Failing bit', 2, 'fail', {
    scenarioIds: ['s1'],
    scenarios: [
      {
        id: 's1',
        title: 'login rate limits',
        outcome: 'fail',
        durationMs: 12,
        failure: { step: 2, expected: 'exit 1', actual: 'exit 0' },
        evidencePath: 'guard/evidence/run1/s1/transcript.txt',
      },
    ],
  }),
  sec('Passing bit', 2, 'pass', {
    scenarioIds: ['s2'],
    scenarios: [{ id: 's2', title: 'passes cleanly', outcome: 'pass', durationMs: 5 }],
  }),
  sec('Stale bit', 2, 'stale', { scenarioIds: ['s3'], scenarios: [{ id: 's3', title: 'stale claim', outcome: 'stale', durationMs: 0 }] }),
  sec('Guarded bit', 2, 'guarded', { scenarioIds: ['g1'] }),
  sec('Blocked bit', 2, 'blocked-on', { reason: 'blocked on db: needs a database', blockedOnCapabilities: ['db'] }),
  sec('Web bit', 2, 'web', { reason: 'browser UI boundary' }),
  sec('Untestable bit', 2, 'untestable', { reason: 'nothing assertable' }),
  sec('Dismissed bit', 2, 'dismissed', { reason: 'dismissed: the rate-limit claim' }),
  sec('Unguarded bit', 2, 'unguarded'),
];

const TOTALS: Record<GuardSectionCoverageStatus, number> = {
  pass: 1,
  fail: 1,
  error: 0,
  stale: 1,
  orphaned: 0,
  guarded: 1,
  web: 1,
  tui: 0,
  'blocked-on': 1,
  untestable: 1,
  'no-claim': 1,
  dismissed: 1,
  unguarded: 1,
};

const COVERAGE: GuardDocCoverage = {
  doc: 'docs/SPEC.md',
  markdown: true,
  sections: SECTIONS,
  orphanedSections: [],
  totals: TOTALS,
  runId: 'run1',
  ranAt: '2026-07-07T00:00:00Z',
  generatedAt: '2026-07-07T00:00:00Z',
};

const CORPUS = {
  data: {
    corpus: {
      version: 1,
      generatedAt: '',
      docs: [{ ref: 'docs/SPEC.md', kind: 'unknown', lastTouched: '', areaTags: [] }],
      areas: [],
    },
  },
  hydrating: false,
  scanning: false,
  error: null,
  corpusCommit: null,
  scan: async () => {},
  refetch: async () => {},
  apply: () => {},
} as unknown as SpecCorpusState;

// A two-doc corpus with a within-area overlap — the sidebar shows two doc rows
// plus one conflict row, so preview/pin and conflict tabs are all exercisable.
const OVERLAP_KEY = overlapKey('core/auth', 'docs/SPEC.md', 'docs/OTHER.md');
const CORPUS2 = {
  ...CORPUS,
  data: {
    corpus: {
      version: 1,
      generatedAt: '',
      docs: [
        { ref: 'docs/SPEC.md', kind: 'prd', lastTouched: '', areaTags: ['core/auth'] },
        { ref: 'docs/OTHER.md', kind: 'prd', lastTouched: '', areaTags: ['core/auth'] },
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
    },
  },
} as unknown as SpecCorpusState;

const ALL_TRUE: GuardStaleness = {
  generateStale: false,
  runStale: false,
  hasCorpus: true,
  hasScenarios: true,
  hasGenerated: true,
  hasRun: true,
};

function stubFetchCoverage(coverage: GuardDocCoverage) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/guard/coverage')) return json(coverage);
      if (u.includes('/spec/doc')) return json({ ref: 'docs/SPEC.md', content: MD });
      if (u.includes('/guard/evidence')) return new Response('TRANSCRIPT-BODY-XYZ', { status: 200 });
      if (u.includes('/guard/scenario')) return json({ id: 's1', file: 's1.yaml', content: 'guard: 1\nid: s1' });
      return json({});
    }),
  );
}

function stubFetch() {
  stubFetchCoverage(COVERAGE);
}

// The main coverage pane, driven by the shared tab reducer (mirrors RepoPage).
function CoveragePane({ staleness, corpus }: { staleness: GuardStaleness; corpus: SpecCorpusState }) {
  const tabs = useGuardCoverageTabs('r');
  return <GuardCoveragePage repoId="r" corpus={corpus} staleness={staleness} staleLoaded tabs={tabs} />;
}

function renderPage(staleness: GuardStaleness, url = '/repos/r?guard=docs%2FSPEC.md', corpus: SpecCorpusState = CORPUS) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CoveragePane staleness={staleness} corpus={corpus} />
    </MemoryRouter>,
  );
}

// The full coverage surface — sidebar (reused SpecCorpusView) + main pane sharing
// ONE tab reducer — plus a probe over the live query, exactly as RepoPage wires it.
function CoverageHarness({ staleness, corpus }: { staleness: GuardStaleness; corpus: SpecCorpusState }) {
  const tabs = useGuardCoverageTabs('r');
  const loc = useLocation();
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <div data-testid="sidebar">
        <SpecCorpusView repoId="r" corpus={corpus} activeKey={tabs.activeId} onOpen={tabs.open} />
      </div>
      <GuardCoveragePage repoId="r" corpus={corpus} staleness={staleness} staleLoaded tabs={tabs} />
    </div>
  );
}

function renderHarness(staleness: GuardStaleness, url = '/repos/r?section=guard&tab=coverage', corpus: SpecCorpusState = CORPUS2) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <CoverageHarness staleness={staleness} corpus={corpus} />
    </MemoryRouter>,
  );
}

const sidebar = () => screen.getByTestId('sidebar');
const search = () => screen.getByTestId('search').textContent ?? '';
// A GuardTabStrip item renders as a <div> holding the visible LABEL plus a
// `Close <id>` button; the id itself rides the hover. The permanent Overview tab
// renders first and has no close button.
const closeBtn = (id: string) => screen.getByLabelText(`Close ${id}`);
const tabEl = (id: string) => closeBtn(id).parentElement as HTMLElement;
// A doc tab's label equals its hover title (both the repo-relative path), so the
// text appears twice in the tab — the visible span and the HoverPopover tooltip.
// Scope to the visible label (the truncating span), never the tooltip.
const tabLabel = (id: string, label: string) =>
  within(tabEl(id)).getByText(label, { selector: 'span.truncate' });

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('GuardCoveragePage — onboarding empty states (the Overview pane)', () => {
  beforeEach(stubFetch);

  it('points to spec scan when there is no corpus', () => {
    renderPage({ ...ALL_TRUE, hasCorpus: false, hasGenerated: false, hasRun: false }, '/repos/r');
    expect(screen.getByText('No spec corpus')).toBeInTheDocument();
    expect(screen.getByText('truecourse spec scan')).toBeInTheDocument();
  });

  it('points to guard generate when the corpus has no guards', () => {
    renderPage({ ...ALL_TRUE, hasGenerated: false, hasRun: false }, '/repos/r');
    expect(screen.getByText('No guards generated')).toBeInTheDocument();
    expect(screen.getByText('truecourse guard generate')).toBeInTheDocument();
  });

  it('points to guard run when generated but never run', () => {
    renderPage({ ...ALL_TRUE, hasRun: false }, '/repos/r');
    expect(screen.getByText('No guard run yet')).toBeInTheDocument();
    expect(screen.getByText('truecourse guard run')).toBeInTheDocument();
  });

  it('renders the raw doc markdown pre-generate when a doc is selected — never the generate empty state', async () => {
    // Corpus present, generate never run, but a doc IS selected → the doc's raw
    // markdown renders so conflicts stay resolvable in context (no coverage fetch,
    // so no totals strip), and the onboarding card never shadows the selection.
    renderPage({ ...ALL_TRUE, hasGenerated: false, hasRun: false });
    expect(await screen.findByText('Intro paragraph.')).toBeInTheDocument();
    expect(screen.queryByText('No guards generated')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Coverage totals' })).not.toBeInTheDocument();
  });
});

describe('GuardCoveragePage — a selected conflict owns the whole main pane', () => {
  beforeEach(stubFetch);

  const CONFLICT_URL =
    '/repos/r?guard=docs%2FSPEC.md&gconf=' +
    encodeURIComponent('overlap::area1::docs/SPEC.md::docs/OTHER.md');

  it('renders the overlap detail full-width and hides the doc coverage center', async () => {
    renderPage(ALL_TRUE, CONFLICT_URL);
    // The overlap detail takes over the pane…
    expect(await screen.findByLabelText('Close conflict detail')).toBeInTheDocument();
    // …and the selected doc's coverage center (its totals strip) does NOT render beside it.
    expect(screen.queryByRole('group', { name: 'Coverage totals' })).not.toBeInTheDocument();
  });

  it('brings the doc coverage back when the conflict is closed', async () => {
    const user = userEvent.setup();
    renderPage(ALL_TRUE, CONFLICT_URL);
    await user.click(await screen.findByLabelText('Close conflict detail'));
    // The doc (opened alongside by the deep link) survives the close → its coverage returns.
    expect(await screen.findByRole('group', { name: 'Coverage totals' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Close conflict detail')).not.toBeInTheDocument();
  });

  // A preamble conflict points at the selected doc with a null heading. The
  // conflict-heading index must skip it (no heading row to tag) rather than throw
  // on `null.trim()`.
  it('tolerates an overlap section with a null (preamble) heading on the selected doc', async () => {
    const corpus = {
      ...CORPUS,
      data: {
        ...CORPUS.data,
        corpus: {
          ...CORPUS.data.corpus,
          areas: [
            {
              id: 'core/languages',
              product: 'core',
              concern: 'languages',
              docRefs: ['docs/SPEC.md', 'docs/OTHER.md'],
              overlaps: [
                {
                  docs: ['docs/SPEC.md', 'docs/OTHER.md'],
                  note: 'README preamble lists C#; OTHER omits it',
                  sections: [
                    { doc: 'docs/SPEC.md', heading: null },
                    { doc: 'docs/OTHER.md', heading: 'Tech Stack' },
                  ],
                },
              ],
            },
          ],
        },
      },
    } as unknown as SpecCorpusState;

    renderPage(ALL_TRUE, '/repos/r?guard=docs%2FSPEC.md', corpus);
    // Renders the coverage surface instead of crashing on the null heading.
    expect(await screen.findByRole('group', { name: 'Coverage totals' })).toBeInTheDocument();
  });
});

describe('GuardCoveragePage — coverage surface', () => {
  beforeEach(stubFetch);

  it('renders the doc and a totals chip per status', async () => {
    renderPage(ALL_TRUE);
    expect(await screen.findByText('Guard Spec')).toBeInTheDocument();
    const strip = screen.getByRole('group', { name: 'Coverage totals' });
    for (const label of ['Passing', 'Failing', 'Guarded (no run)', 'Blocked on', 'Needs web driver', 'Untestable']) {
      expect(within(strip).getByText(label)).toBeInTheDocument();
    }
  });

  it('groups the chips into CLI vs Other-drivers clusters, separated by a divider', async () => {
    const { container } = renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');
    const strip = screen.getByRole('group', { name: 'Coverage totals' });

    const cli = within(strip).getByRole('group', { name: 'CLI, API' });
    const others = within(strip).getByRole('group', { name: 'Other drivers' });

    // CLI verdicts + coverage gaps (incl. the user's dismissals) live in the CLI
    // cluster, never among the drivers.
    for (const label of ['Passing', 'Failing', 'Stale', 'Guarded (no run)', 'Blocked on', 'Untestable', 'No claim', 'Dismissed', 'Unguarded']) {
      expect(within(cli).getByText(label)).toBeInTheDocument();
      expect(within(others).queryByText(label)).not.toBeInTheDocument();
    }

    // The future-driver postponement lives in the Other-drivers cluster only.
    expect(within(others).getByText('Needs web driver')).toBeInTheDocument();
    expect(within(cli).queryByText('Needs web driver')).not.toBeInTheDocument();

    // A subtle divider physically separates the two clusters.
    expect(container.querySelector('span[aria-hidden].w-px')).not.toBeNull();
  });

  it('hides the Other-drivers cluster (label + divider) when no driver sections exist', async () => {
    // Coverage with every driver status at zero — the cluster must not render.
    const driverFree: GuardDocCoverage = {
      ...COVERAGE,
      sections: SECTIONS.filter((s) => s.status !== 'web'),
      totals: { ...TOTALS, web: 0 },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/coverage')) return json(driverFree);
        if (u.includes('/spec/doc')) return json({ ref: 'docs/SPEC.md', content: MD });
        return json({});
      }),
    );
    const { container } = renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');

    expect(screen.getByRole('group', { name: 'CLI, API' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Other drivers' })).not.toBeInTheDocument();
    expect(container.querySelector('span[aria-hidden].w-px')).toBeNull();
  });

  it('paints each section with its status band', async () => {
    const { container } = renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');
    const bandOf = (anchor: string) =>
      (container.querySelector(`[data-anchor="${anchor}"]`) as HTMLElement).className;
    expect(bandOf('failing-bit')).toContain('border-red-500');
    expect(bandOf('passing-bit')).toContain('border-emerald-500');
    expect(bandOf('stale-bit')).toContain('border-amber-500');
    expect(bandOf('guarded-bit')).toContain('border-sky-500');
    expect(bandOf('blocked-bit')).toContain('bg-muted');
    expect(bandOf('web-bit')).toContain('border-dashed');
    // Unguarded stays unmarked (no band wrapper classes).
    expect(bandOf('unguarded-bit')).not.toContain('border-l-4');
  });

  it('filters the doc when a totals chip is clicked', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');
    const strip = screen.getByRole('group', { name: 'Coverage totals' });
    await user.click(within(strip).getByRole('button', { name: /Passing/ }));
    const fail = container.querySelector('[data-anchor="failing-bit"]') as HTMLElement;
    const pass = container.querySelector('[data-anchor="passing-bit"]') as HTMLElement;
    expect(fail.className).toContain('opacity-40');
    expect(pass.className).not.toContain('opacity-40');
    expect(within(strip).getByRole('button', { name: /Passing/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('toggles the active filter between blur (dim) and hide (collapse)', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');
    const strip = screen.getByRole('group', { name: 'Coverage totals' });
    const failEl = () => container.querySelector('[data-anchor="failing-bit"]') as HTMLElement | null;

    // No filter → no display-mode toggle.
    expect(screen.queryByRole('group', { name: 'Filter display mode' })).not.toBeInTheDocument();

    // Filter to Passing → toggle appears, blur is the default (non-match dimmed).
    await user.click(within(strip).getByRole('button', { name: /Passing/ }));
    const modeGroup = screen.getByRole('group', { name: 'Filter display mode' });
    expect(failEl()?.className).toContain('opacity-40');

    // Hide → the non-matching section leaves the DOM; the match stays.
    await user.click(within(modeGroup).getByRole('button', { name: 'Hide' }));
    expect(failEl()).toBeNull();
    expect(container.querySelector('[data-anchor="passing-bit"]')).not.toBeNull();
    expect(localStorage.getItem('truecourse:guardFilterMode')).toBe('hide');

    // Back to Blur → dimmed in place again.
    await user.click(within(modeGroup).getByRole('button', { name: 'Blur' }));
    expect(failEl()?.className).toContain('opacity-40');
  });

  it('expands the blocked-on chip to the per-capability breakdown', async () => {
    const user = userEvent.setup();
    renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');
    const strip = screen.getByRole('group', { name: 'Coverage totals' });
    // The breakdown is hidden until the blocked-on chip is the active filter.
    expect(screen.queryByText('db')).not.toBeInTheDocument();
    await user.click(within(strip).getByRole('button', { name: /Blocked on/ }));
    // The tally (moved from the Report tab) now names the doc's blocked capability.
    expect(await screen.findByText('db')).toBeInTheDocument();
  });
});

describe('GuardCoveragePage — section detail + evidence', () => {
  beforeEach(stubFetch);

  it('opens the section detail with scenarios and their failure detail', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');

    await user.click(container.querySelector('[data-anchor="failing-bit"]') as HTMLElement);
    expect(await screen.findByText('login rate limits')).toBeInTheDocument();

    await user.click(screen.getByText('login rate limits'));
    expect(await screen.findByText('exit 1')).toBeInTheDocument();
    expect(screen.getByText('exit 0')).toBeInTheDocument();
  });

  it('fetches and renders the evidence transcript', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');

    await user.click(container.querySelector('[data-anchor="failing-bit"]') as HTMLElement);
    await user.click(await screen.findByText('login rate limits'));
    await user.click(screen.getByText('View evidence'));
    expect(await screen.findByText('TRANSCRIPT-BODY-XYZ')).toBeInTheDocument();
  });

  it('shows the run empty state in the detail for a guarded section with no run results', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');
    await user.click(container.querySelector('[data-anchor="guarded-bit"]') as HTMLElement);
    expect(await screen.findByText(/No guard run yet|Not in the last run/)).toBeInTheDocument();
    expect(screen.getByText('g1')).toBeInTheDocument();
  });

  it('offers evidence on a PASSING row when the run captured a transcript (evidence for passes too)', async () => {
    const user = userEvent.setup();
    // The passing s2 carries an evidencePath, as a run now writes for every executed outcome.
    stubFetchCoverage({
      ...COVERAGE,
      sections: SECTIONS.map((s) =>
        s.anchor === 'passing-bit'
          ? {
              ...s,
              scenarios: s.scenarios.map((sc) => ({ ...sc, evidencePath: 'guard/evidence/run1/s2/transcript.txt' })),
            }
          : s,
      ),
    });
    const { container } = renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');

    await user.click(container.querySelector('[data-anchor="passing-bit"]') as HTMLElement);
    await user.click(await screen.findByText('passes cleanly'));
    // The pass row exposes the same evidence affordance a failing row gets.
    await user.click(screen.getByText('View evidence'));
    expect(await screen.findByText('TRANSCRIPT-BODY-XYZ')).toBeInTheDocument();
  });

  it('offers no evidence on a pass without a captured transcript (older run)', async () => {
    const user = userEvent.setup();
    const { container } = renderPage(ALL_TRUE); // the default s2 pass has no evidencePath
    await screen.findByText('Guard Spec');

    await user.click(container.querySelector('[data-anchor="passing-bit"]') as HTMLElement);
    await user.click(await screen.findByText('passes cleanly'));
    // The row expands (its YAML affordance shows) but offers no evidence.
    expect(screen.getByText('View YAML source')).toBeInTheDocument();
    expect(screen.queryByText('View evidence')).not.toBeInTheDocument();
  });
});

describe('GuardCoveragePage — the shared preview/pin tab model', () => {
  beforeEach(stubFetch);

  it('single-click on a sidebar doc opens a PREVIEW tab (italic) mirroring ?guard', async () => {
    const user = userEvent.setup();
    renderHarness(ALL_TRUE);
    await within(sidebar()).findByText('docs/SPEC.md');
    await user.click(within(sidebar()).getByText('docs/SPEC.md'));
    // A transient (unpinned → italic) doc tab, labelled by the repo-relative path.
    expect(tabLabel('docs/SPEC.md', 'docs/SPEC.md')).toHaveClass('italic');
    expect(search()).toContain('guard=docs%2FSPEC.md');
    expect(search()).not.toContain('spec=');
  });

  it('the next single-click REPLACES the preview tab', async () => {
    const user = userEvent.setup();
    renderHarness(ALL_TRUE);
    await within(sidebar()).findByText('docs/SPEC.md');
    await user.click(within(sidebar()).getByText('docs/SPEC.md'));
    await user.click(within(sidebar()).getByText('docs/OTHER.md'));
    // One doc tab only — OTHER took the transient slot from SPEC.
    expect(screen.queryByLabelText('Close docs/SPEC.md')).not.toBeInTheDocument();
    expect(tabLabel('docs/OTHER.md', 'docs/OTHER.md')).toHaveClass('italic');
    expect(search()).toContain('guard=docs%2FOTHER.md');
  });

  it('double-click PINS the tab so the next preview coexists with it', async () => {
    const user = userEvent.setup();
    renderHarness(ALL_TRUE);
    await within(sidebar()).findByText('docs/SPEC.md');
    await user.dblClick(within(sidebar()).getByText('docs/SPEC.md'));
    expect(tabLabel('docs/SPEC.md', 'docs/SPEC.md')).toHaveClass('font-medium');
    await user.click(within(sidebar()).getByText('docs/OTHER.md'));
    // Both tabs open: the pinned SPEC plus the transient OTHER.
    expect(tabLabel('docs/SPEC.md', 'docs/SPEC.md')).toHaveClass('font-medium');
    expect(tabLabel('docs/OTHER.md', 'docs/OTHER.md')).toHaveClass('italic');
  });

  it('a conflict opens as a tab labelled "a ↔ b" (both repo-relative paths) mirroring ?gconf', async () => {
    const user = userEvent.setup();
    renderHarness(ALL_TRUE);
    await within(sidebar()).findByText('docs/SPEC.md ↔ docs/OTHER.md');
    await user.click(within(sidebar()).getByText('docs/SPEC.md ↔ docs/OTHER.md'));
    // The conflict tab carries the ↔ label; the overlap detail owns the pane.
    expect(tabLabel(OVERLAP_KEY, 'docs/SPEC.md ↔ docs/OTHER.md')).toBeInTheDocument();
    expect(await screen.findByLabelText('Close conflict detail')).toBeInTheDocument();
    expect(search()).toContain('gconf=');
    expect(decodeURIComponent(search())).toContain(OVERLAP_KEY);
  });

  it('shows no strip (not even an Overview chip) while no item tab is open', () => {
    // No ?guard/?gconf and never-run → the Overview onboarding fills the pane, no strip.
    renderHarness({ ...ALL_TRUE, hasRun: false });
    expect(screen.getByText('No guard run yet')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).toBeNull();
  });

  it('the Overview chip clears the item selection back to the onboarding pane WITHOUT closing tabs', async () => {
    const user = userEvent.setup();
    renderHarness(ALL_TRUE);
    await within(sidebar()).findByText('docs/SPEC.md');
    await user.click(within(sidebar()).getByText('docs/SPEC.md'));
    expect(screen.getByText('Overview')).toBeInTheDocument();
    await user.click(screen.getByText('Overview'));
    // Back on the Overview pane (all stages done → "select a document"); tab stays.
    expect(await screen.findByText('Select a document')).toBeInTheDocument();
    expect(closeBtn('docs/SPEC.md')).toBeInTheDocument();
    expect(search()).not.toContain('guard=');
  });

  it('closing the last tab hides the strip and returns to the Overview pane', async () => {
    const user = userEvent.setup();
    renderHarness(ALL_TRUE);
    await within(sidebar()).findByText('docs/SPEC.md');
    await user.click(within(sidebar()).getByText('docs/SPEC.md'));
    expect(screen.getByText('Overview')).toBeInTheDocument();
    await user.click(closeBtn('docs/SPEC.md'));
    // Last item tab closed → the strip/chip is gone and the pane is the Overview.
    expect(screen.queryByText('Overview')).toBeNull();
    expect(await screen.findByText('Select a document')).toBeInTheDocument();
    expect(search()).not.toContain('guard=');
  });

  it('a ?guard deep link opens the doc as a pinned tab and renders its coverage', async () => {
    renderHarness(ALL_TRUE, '/repos/r?section=guard&tab=coverage&guard=docs%2FSPEC.md');
    expect(await screen.findByRole('group', { name: 'Coverage totals' })).toBeInTheDocument();
    expect(tabLabel('docs/SPEC.md', 'docs/SPEC.md')).toHaveClass('font-medium');
  });

  it('a section detail opens WITHIN the active doc tab (?gsec), not as a tab', async () => {
    const user = userEvent.setup();
    const { container } = renderHarness(ALL_TRUE, '/repos/r?section=guard&tab=coverage&guard=docs%2FSPEC.md');
    await screen.findByRole('group', { name: 'Coverage totals' });
    await user.click(container.querySelector('[data-anchor="failing-bit"]') as HTMLElement);
    // The section's scenario detail opens; the doc tab is still the only item tab.
    expect(await screen.findByText('login rate limits')).toBeInTheDocument();
    expect(search()).toContain('gsec=failing-bit');
    expect(screen.queryByLabelText('Close docs/OTHER.md')).not.toBeInTheDocument();
  });
});
