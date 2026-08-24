/**
 * Spec Guard "generation blocked on open conflicts" tests.
 *
 * When birth generation ends `open-conflicts` there are NO scenarios and NO runs,
 * so the Scenarios tab shows a BLOCKED PANEL (live conflict list from the corpus,
 * each row routing to the Coverage tab's resolver) and the Runs tab a one-line
 * blocked note that routes to Coverage. Covered here:
 *   - `buildOpenConflictRows` — the LIVE derivation (open subset, area label,
 *     deep-link key) off a `SpecCorpusResponse`.
 *   - `GuardBlockedPanel` — loading / resolved / blocked-list states + row clicks.
 *   - `GuardScenariosOverview` — swaps to the blocked panel on `open-conflicts`,
 *     leaves the normal overview/empty state untouched otherwise.
 *   - `GuardDriftsView` — the no-run empty state's blocked variant + its Coverage
 *     route (URL `section=guard&tab=coverage`).
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import type { GuardGenerateReport } from '@truecourse/shared';
import type { SpecConflictResolution, SpecCorpusResponse } from '@/lib/api';
import {
  GuardBlockedPanel,
  buildOpenConflictRows,
  type BlockedConflictRow,
} from '@/components/guard/GuardBlockedPanel';
import { GuardScenariosOverview } from '@/components/guard/GuardScenariosOverview';
import { GuardDriftsView } from '@/components/guard/GuardDriftsView';
import { overlapKey } from '@/components/spec/SpecCorpusView';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
const notFound = () => new Response(JSON.stringify({ error: 'nope' }), { status: 404 });

// A single-product corpus (product `core` throughout) with two distinct open
// conflicts, one per area. Single product ⇒ area labels drop the `core/` prefix.
const corpusResponse = (
  conflictResolutions: SpecConflictResolution[] = [],
): SpecCorpusResponse => ({
  corpus: {
    version: 1,
    generatedAt: '2026-07-07T00:00:00.000Z',
    docs: [
      { ref: 'docs/auth.md', kind: 'md', lastTouched: '2026-07-01', areaTags: ['core/auth'] },
      { ref: 'docs/login.md', kind: 'md', lastTouched: '2026-07-02', areaTags: ['core/auth'] },
      { ref: 'docs/billing.md', kind: 'md', lastTouched: '2026-07-01', areaTags: ['core/billing'] },
      { ref: 'docs/invoice.md', kind: 'md', lastTouched: '2026-07-02', areaTags: ['core/billing'] },
    ],
    areas: [
      {
        id: 'core/auth',
        product: 'core',
        concern: 'auth',
        docRefs: ['docs/auth.md', 'docs/login.md'],
        overlaps: [
          {
            docs: ['docs/auth.md', 'docs/login.md'],
            note: 'Both define the lockout threshold differently.',
            sections: [
              { doc: 'docs/auth.md', heading: 'Lockout', quote: 'five attempts' },
              { doc: 'docs/login.md', heading: 'Lockout', quote: 'three attempts' },
            ],
          },
        ],
      },
      {
        id: 'core/billing',
        product: 'core',
        concern: 'billing',
        docRefs: ['docs/billing.md', 'docs/invoice.md'],
        overlaps: [
          {
            docs: ['docs/billing.md', 'docs/invoice.md'],
            note: 'Currency rounding rules conflict.',
            sections: [
              { doc: 'docs/billing.md', heading: 'Rounding', quote: 'round up' },
              { doc: 'docs/invoice.md', heading: 'Rounding', quote: 'round down' },
            ],
          },
        ],
      },
    ],
    skippedDocs: [],
  },
  manualExcludes: [],
  conflictResolutions,
});

// A verdict that resolves the auth pair (matches its dispute identity).
const AUTH_VERDICT: SpecConflictResolution = {
  docA: 'docs/auth.md',
  anchorA: 'Lockout',
  quoteA: 'five attempts',
  docB: 'docs/login.md',
  anchorB: 'Lockout',
  quoteB: 'three attempts',
  verdict: 'a',
};

const BLOCKED_REPORT: GuardGenerateReport = {
  generatedAt: '2026-07-07T00:00:00.000Z',
  status: 'open-conflicts',
  reason: '2 open spec conflicts must be resolved before generation can proceed.',
  sectionsTotal: 0,
  sectionsChanged: 0,
  skippedUnchanged: 0,
  noChanges: false,
  written: [],
  coverageGaps: [],
  birthFindings: [],
  errors: [],
  extractionFailures: [],
  orphaned: [],
};

afterEach(() => vi.unstubAllGlobals());

describe('buildOpenConflictRows — live open-conflict derivation', () => {
  it('returns one row per open conflict with a display area label + deep-link key', () => {
    const rows = buildOpenConflictRows(corpusResponse());
    expect(rows).toHaveLength(2);
    const byArea = Object.fromEntries(rows.map((r) => [r.areaLabel, r]));
    // Single-product corpus ⇒ the `core/` prefix is dropped from the label.
    expect(Object.keys(byArea).sort()).toEqual(['auth', 'billing']);
    expect(byArea.auth.note).toBe('Both define the lockout threshold differently.');
    // The key is the shared overlap deep-link the Coverage tab resolves.
    expect(byArea.auth.key).toBe(overlapKey('core/auth', byArea.auth.a, byArea.auth.b));
    expect(byArea.auth.key.startsWith('overlap::core/auth::')).toBe(true);
    expect([byArea.auth.a, byArea.auth.b].sort()).toEqual(['docs/auth.md', 'docs/login.md']);
  });

  it('drops a conflict once a verdict resolves it (live)', () => {
    const rows = buildOpenConflictRows(corpusResponse([AUTH_VERDICT]));
    expect(rows).toHaveLength(1);
    expect(rows[0].areaLabel).toBe('billing');
  });

  it('returns no rows when every conflict is resolved', () => {
    const both: SpecConflictResolution[] = [
      AUTH_VERDICT,
      {
        docA: 'docs/billing.md',
        anchorA: 'Rounding',
        quoteA: 'round up',
        docB: 'docs/invoice.md',
        anchorB: 'Rounding',
        quoteB: 'round down',
        verdict: 'b',
      },
    ];
    expect(buildOpenConflictRows(corpusResponse(both))).toHaveLength(0);
  });
});

describe('GuardBlockedPanel', () => {
  const ROWS: BlockedConflictRow[] = [
    {
      areaLabel: 'auth',
      a: 'docs/auth.md',
      b: 'docs/login.md',
      note: 'Both define the lockout threshold differently.',
      key: 'overlap::core/auth::docs/auth.md::docs/login.md',
    },
  ];

  it('spins while the corpus is still loading (conflicts === null)', () => {
    const { container } = render(<GuardBlockedPanel conflicts={null} onOpenConflict={vi.fn()} />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
    expect(screen.queryByText(/blocked/i)).not.toBeInTheDocument();
  });

  it('renders the blocked headline, count, note, and no CLI command', () => {
    render(<GuardBlockedPanel conflicts={ROWS} onOpenConflict={vi.fn()} />);
    expect(screen.getByText('Scenario generation is blocked')).toBeInTheDocument();
    // Names the feature "Spec Guard"; counts the open conflicts.
    expect(screen.getByText(/1 open spec conflict must be resolved before Spec Guard/)).toBeInTheDocument();
    expect(screen.getByText('docs/auth.md ↔ docs/login.md')).toBeInTheDocument();
    expect(screen.getByText('auth')).toBeInTheDocument();
    expect(screen.getByText('Both define the lockout threshold differently.')).toBeInTheDocument();
    // EE users can't run the CLI locally — no command must appear.
    expect(screen.queryByText(/truecourse/)).not.toBeInTheDocument();
  });

  it('routes a row click to its conflict key', async () => {
    const user = userEvent.setup();
    const onOpenConflict = vi.fn();
    render(<GuardBlockedPanel conflicts={ROWS} onOpenConflict={onOpenConflict} />);
    await user.click(screen.getByText('docs/auth.md ↔ docs/login.md'));
    expect(onOpenConflict).toHaveBeenCalledWith(ROWS[0].key);
  });

  it('flips to the "resolved — will re-run" note when the live count is zero', () => {
    render(<GuardBlockedPanel conflicts={[]} onOpenConflict={vi.fn()} />);
    expect(screen.getByText('Spec conflicts resolved')).toBeInTheDocument();
    expect(screen.getByText(/write the missing scenarios on the next generate/)).toBeInTheDocument();
    expect(screen.queryByText('Scenario generation is blocked')).not.toBeInTheDocument();
  });
});

describe('GuardScenariosOverview — open-conflicts state', () => {
  const CONFLICTS: BlockedConflictRow[] = [
    {
      areaLabel: 'auth',
      a: 'docs/auth.md',
      b: 'docs/login.md',
      note: 'Lockout threshold conflict.',
      key: 'overlap::core/auth::docs/auth.md::docs/login.md',
    },
  ];

  it('renders the blocked panel over the live conflicts, not the empty state', async () => {
    const user = userEvent.setup();
    const onOpenConflict = vi.fn();
    render(
      <GuardScenariosOverview
        recipe={null}
        report={BLOCKED_REPORT}
        flows={[]}
        filter="all"
        onFilter={vi.fn()}
        loading={false}
        error={null}
        onOpenSpec={vi.fn()}
        conflicts={CONFLICTS}
        onOpenConflict={onOpenConflict}
      />,
    );
    expect(screen.getByText('Scenario generation is blocked')).toBeInTheDocument();
    // The OSS "No scenarios yet" empty state must NOT show in the blocked case.
    expect(screen.queryByText('No flows yet')).not.toBeInTheDocument();
    await user.click(screen.getByText('docs/auth.md ↔ docs/login.md'));
    expect(onOpenConflict).toHaveBeenCalledWith(CONFLICTS[0].key);
  });

  it('shows the resolved note when the live conflicts drained to zero', () => {
    render(
      <GuardScenariosOverview
        recipe={null}
        report={BLOCKED_REPORT}
        flows={[]}
        filter="all"
        onFilter={vi.fn()}
        loading={false}
        error={null}
        onOpenSpec={vi.fn()}
        conflicts={[]}
        onOpenConflict={vi.fn()}
      />,
    );
    expect(screen.getByText('Spec conflicts resolved')).toBeInTheDocument();
  });

  it('leaves the normal empty state untouched for a non-blocked report', () => {
    render(
      <GuardScenariosOverview
        recipe={null}
        report={null}
        flows={[]}
        filter="all"
        onFilter={vi.fn()}
        loading={false}
        error={null}
        onOpenSpec={vi.fn()}
      />,
    );
    expect(screen.getByText('No flows yet')).toBeInTheDocument();
    expect(screen.queryByText('Scenario generation is blocked')).not.toBeInTheDocument();
  });
});

describe('GuardDriftsView — blocked-on-conflicts no-run note', () => {
  function stubNoRun() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/latest')) return notFound();
        if (u.includes('/guard/history')) return json({ runs: [] });
        return json({});
      }),
    );
  }

  function LocationProbe() {
    const [params] = useSearchParams();
    return <div data-testid="qs">{params.toString()}</div>;
  }

  function renderView(blocked: boolean) {
    return render(
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=guarddrifts']}>
        <GuardDriftsView repoId="r" blockedOnConflicts={blocked} />
        <LocationProbe />
      </MemoryRouter>,
    );
  }

  it('shows the blocked note instead of "No guard run yet" and routes to Coverage', async () => {
    const user = userEvent.setup();
    stubNoRun();
    renderView(true);
    expect(await screen.findByText('Blocked by open spec conflicts')).toBeInTheDocument();
    expect(screen.queryByText('No guard run yet')).not.toBeInTheDocument();
    // No CLI command in the EE blocked note.
    expect(screen.queryByText('truecourse guard run')).not.toBeInTheDocument();
    await user.click(screen.getByText('Resolve them on the Coverage tab'));
    const qs = new URLSearchParams(screen.getByTestId('qs').textContent ?? '');
    expect(qs.get('section')).toBe('guard');
    expect(qs.get('tab')).toBe('coverage');
  });

  it('falls back to the normal "No guard run yet" empty state when not blocked', async () => {
    stubNoRun();
    renderView(false);
    expect(await screen.findByText('No guard run yet')).toBeInTheDocument();
    expect(screen.queryByText('Blocked by open spec conflicts')).not.toBeInTheDocument();
  });
});
