/**
 * Guard coverage view tests: the onboarding empty states, coverage rendering
 * with per-status treatments, the filtering totals strip (incl. the blocked-on
 * chip expanding to the capability breakdown moved from the Report tab), section →
 * scenario detail, and the evidence transcript fetch. Fetches are stubbed the
 * house way (`vi.stubGlobal('fetch', …)` routed by URL); the component is mounted
 * under a MemoryRouter (it reads `?guard=`/`?gsec=` for selection).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type {
  GuardDocCoverage,
  GuardSectionCoverage,
  GuardSectionCoverageStatus,
  GuardStaleness,
} from '@truecourse/shared';
import type { SpecCorpusState } from '@/components/spec/SpecCorpusView';
import { GuardCoveragePage } from '@/components/guard/GuardCoveragePage';

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
  '## Api bit',
  'HTTP boundary.',
  '',
  '## Untestable bit',
  'Nothing assertable.',
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
  sec('Api bit', 2, 'api', { reason: 'HTTP boundary' }),
  sec('Untestable bit', 2, 'untestable', { reason: 'nothing assertable' }),
  sec('Unguarded bit', 2, 'unguarded'),
];

const TOTALS: Record<GuardSectionCoverageStatus, number> = {
  pass: 1,
  fail: 1,
  error: 0,
  stale: 1,
  orphaned: 0,
  guarded: 1,
  api: 1,
  web: 0,
  tui: 0,
  'blocked-on': 1,
  untestable: 1,
  'no-claim': 1,
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
      relations: [],
    },
    userRelations: [],
  },
  hydrating: false,
  scanning: false,
  error: null,
  corpusCommit: null,
  scan: async () => {},
  refetch: async () => {},
  apply: () => {},
} as unknown as SpecCorpusState;

const ALL_TRUE: GuardStaleness = {
  generateStale: false,
  runStale: false,
  hasCorpus: true,
  hasScenarios: true,
  hasGenerated: true,
  hasRun: true,
};

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/guard/coverage')) return json(COVERAGE);
      if (u.includes('/spec/doc')) return json({ ref: 'docs/SPEC.md', content: MD });
      if (u.includes('/guard/evidence')) return new Response('TRANSCRIPT-BODY-XYZ', { status: 200 });
      if (u.includes('/guard/scenario')) return json({ id: 's1', file: 's1.yaml', content: 'guard: 1\nid: s1' });
      return json({});
    }),
  );
}

function renderPage(staleness: GuardStaleness, url = '/repos/r?guard=docs%2FSPEC.md') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <GuardCoveragePage repoId="r" corpus={CORPUS} staleness={staleness} staleLoaded />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('GuardCoveragePage — onboarding empty states', () => {
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
});

describe('GuardCoveragePage — coverage surface', () => {
  beforeEach(stubFetch);

  it('renders the doc and a totals chip per status', async () => {
    renderPage(ALL_TRUE);
    expect(await screen.findByText('Guard Spec')).toBeInTheDocument();
    const strip = screen.getByRole('group', { name: 'Coverage totals' });
    for (const label of ['Passing', 'Failing', 'Guarded (no run)', 'Blocked on', 'Needs API driver', 'Untestable']) {
      expect(within(strip).getByText(label)).toBeInTheDocument();
    }
  });

  it('groups the chips into CLI vs Other-drivers clusters, separated by a divider', async () => {
    const { container } = renderPage(ALL_TRUE);
    await screen.findByText('Guard Spec');
    const strip = screen.getByRole('group', { name: 'Coverage totals' });

    const cli = within(strip).getByRole('group', { name: 'CLI' });
    const others = within(strip).getByRole('group', { name: 'Other drivers' });

    // CLI verdicts + coverage gaps live in the CLI cluster, never among the drivers.
    for (const label of ['Passing', 'Failing', 'Stale', 'Guarded (no run)', 'Blocked on', 'Untestable', 'No claim', 'Unguarded']) {
      expect(within(cli).getByText(label)).toBeInTheDocument();
      expect(within(others).queryByText(label)).not.toBeInTheDocument();
    }

    // The future-driver postponement lives in the Other-drivers cluster only.
    expect(within(others).getByText('Needs API driver')).toBeInTheDocument();
    expect(within(cli).queryByText('Needs API driver')).not.toBeInTheDocument();

    // A subtle divider physically separates the two clusters.
    expect(container.querySelector('span[aria-hidden].w-px')).not.toBeNull();
  });

  it('hides the Other-drivers cluster (label + divider) when no driver sections exist', async () => {
    // Coverage with every driver status at zero — the cluster must not render.
    const driverFree: GuardDocCoverage = {
      ...COVERAGE,
      sections: SECTIONS.filter((s) => s.status !== 'api'),
      totals: { ...TOTALS, api: 0 },
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

    expect(screen.getByRole('group', { name: 'CLI' })).toBeInTheDocument();
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
    expect(bandOf('api-bit')).toContain('border-dashed');
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
});
