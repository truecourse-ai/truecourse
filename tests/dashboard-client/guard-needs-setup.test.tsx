/**
 * NEEDS SETUP in the UI (item 65) — the blocked gap that is a to-do.
 *
 * Three things must be true wherever it renders: it is told APART from a failure
 * and from the grey blocked wall (its own word, its own orange paint, in both
 * themes), it NAMES the third party, and it carries the one action that clears it
 * — a link to the External APIs page, or, once the account exists, the re-generate
 * command instead.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type {
  GuardFlowGap,
  GuardSectionCoverage,
  GuardSectionCoverageStatus,
} from '@truecourse/shared';
import { GuardSectionDetail } from '@/components/guard/GuardSectionDetail';
import { GuardTotalsStrip } from '@/components/guard/GuardTotalsStrip';
import { GuardSurfaceChip } from '@/components/guard/GuardSurfaceChip';
import { useGuardView } from '@/hooks/useGuardView';
import { guardGapNeed, guardStatusLabel, guardStatusWord } from '@/lib/guard-flow-status';
import { guardStatusMeta } from '@/lib/guard-status';
import { tallyNeedsSetup } from '@/lib/guard-report';

afterEach(cleanup);

const emptyTotals = (over: Partial<Record<GuardSectionCoverageStatus, number>>) =>
  ({
    fail: 0, error: 0, stale: 0, orphaned: 0, pass: 0, guarded: 0,
    'needs-setup': 0, 'blocked-on': 0, unrealizable: 0, 'no-journey': 0,
    web: 0, tui: 0, library: 0, desktop: 0, mobile: 0,
    untestable: 0, 'no-claim': 0, dismissed: 0, unguarded: 0,
    ...over,
  }) as Record<GuardSectionCoverageStatus, number>;

const NEEDS_SETUP_GAP: GuardFlowGap = {
  kind: 'blocked-on',
  reason: 'blocked on open-meteo: the forecast comes from upstream',
  label: 'blocked-on',
  needsSetup: { services: ['open-meteo'], provided: [] },
};

const section = (over: Partial<GuardSectionCoverage> = {}): GuardSectionCoverage => ({
  anchor: 'forecast',
  headingText: 'Forecast',
  level: 2,
  fingerprint: 'sha256:x',
  status: 'needs-setup',
  reason: NEEDS_SETUP_GAP.reason,
  needsSetup: { services: ['open-meteo'], provided: [] },
  flows: [],
  scenarioIds: [],
  scenarios: [],
  ...over,
});

// ---------------------------------------------------------------------------
// The vocabulary + paint: one word, one colour, both themes.
// ---------------------------------------------------------------------------

describe('needs-setup vocabulary and paint', () => {
  it('wears its OWN word — never the blocked one it was promoted out of', () => {
    expect(guardStatusWord('needs-setup')).toBe('Needs setup');
    expect(guardStatusLabel('needs-setup')).toBe('Needs setup');
    expect(guardStatusWord('blocked-on')).toBe('Blocked');
  });

  it('is orange in BOTH themes — not fail red, not the gaps’ grey, not stale amber', () => {
    const meta = guardStatusMeta('needs-setup');
    expect(meta.badge).toContain('orange');
    expect(meta.badge).toContain('dark:text-orange-400');
    expect(meta.band).toContain('orange');
    expect(meta.dot).toBe('bg-orange-500');
    expect(guardStatusMeta('fail').badge).toContain('red');
    expect(guardStatusMeta('blocked-on').badge).not.toContain('orange');
    expect(guardStatusMeta('stale').badge).not.toContain('orange');
  });

  it('names the SERVICE in the surface chip instead of a generic need', () => {
    expect(guardGapNeed(NEEDS_SETUP_GAP)).toBe('needs setup: open-meteo');
    expect(
      guardGapNeed({ ...NEEDS_SETUP_GAP, needsSetup: { services: [], provided: ['open-meteo'] } }),
    ).toBe('open-meteo is set up — re-run guard generate to author these flows');
    // Two outstanding services read as one English phrase.
    expect(
      guardGapNeed({ ...NEEDS_SETUP_GAP, needsSetup: { services: ['open-meteo', 'stripe'], provided: [] } }),
    ).toBe('needs setup: open-meteo and stripe');
    // The same gap WITHOUT the derivation is untouched — plain blocked copy.
    const { needsSetup: _dropped, ...plain } = NEEDS_SETUP_GAP;
    expect(guardGapNeed(plain)).toBe('needs open-meteo');
  });

  it('paints the surface chip orange and says the service on it', () => {
    render(<GuardSurfaceChip data={{ surface: 'api', status: 'needs-setup', gap: NEEDS_SETUP_GAP }} />);
    const chip = screen.getByText(/API · needs setup: open-meteo/);
    expect(chip.className).toContain('orange');
  });
});

// ---------------------------------------------------------------------------
// The totals strip — the blocked chip, split.
// ---------------------------------------------------------------------------

describe('GuardTotalsStrip — needs setup is its own chip', () => {
  const renderStrip = (
    over: Partial<Parameters<typeof GuardTotalsStrip>[0]> = {},
    onOpenExternals?: () => void,
  ) =>
    render(
      <GuardTotalsStrip
        totals={emptyTotals({ 'needs-setup': 3, 'blocked-on': 2, pass: 1 })}
        activeFilter={null}
        onFilter={() => {}}
        filterMode="blur"
        onFilterModeChange={() => {}}
        needsSetupServices={[{ service: 'open-meteo', count: 3, provided: false }]}
        {...(onOpenExternals ? { onOpenExternals } : {})}
        {...over}
      />,
    );

  it('splits the blocked count into two chips — attention first, wall second', () => {
    renderStrip();
    const strip = screen.getByRole('group', { name: 'Coverage totals' });
    const chips = within(strip)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(chips).toContain('3Needs setup');
    expect(chips).toContain('2Blocked');
    expect(chips.indexOf('3Needs setup')).toBeLessThan(chips.indexOf('2Blocked'));
  });

  it('expands into per-service rows when it is the active filter', () => {
    renderStrip({ activeFilter: 'needs-setup' });
    const expansion = screen.getByRole('group', { name: 'Needs setup' });
    const row = within(expansion).getByRole('button');
    expect(row).toHaveTextContent('open-meteo');
    expect(row).toHaveTextContent('3 sections');
    expect(row.className).toContain('orange');
    expect(
      within(expansion).getByText(/Provide these on the External APIs page/),
    ).toBeInTheDocument();
  });

  it('each service row is the CTA — it opens the External APIs page', async () => {
    const onOpenExternals = vi.fn();
    renderStrip({ activeFilter: 'needs-setup' }, onOpenExternals);
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Needs setup' })).getByRole('button'),
    );
    expect(onOpenExternals).toHaveBeenCalledTimes(1);
  });

  it('the ALREADY-PROVIDED sub-state says re-generate, not "provide"', () => {
    renderStrip({
      activeFilter: 'needs-setup',
      needsSetupServices: [{ service: 'open-meteo', count: 2, provided: true }],
    });
    const expansion = screen.getByRole('group', { name: 'Needs setup' });
    expect(within(expansion).getByText('· re-generate')).toBeInTheDocument();
    expect(
      within(expansion).getByText(/run `truecourse guard generate` to author these flows/),
    ).toBeInTheDocument();
    expect(within(expansion).queryByText(/Provide these/)).not.toBeInTheDocument();
  });

  it('shows no expansion for the blocked chip’s own filter', () => {
    renderStrip({ activeFilter: 'blocked-on' });
    expect(screen.queryByRole('group', { name: 'Needs setup' })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The section detail — the inline CTA.
// ---------------------------------------------------------------------------

describe('GuardSectionDetail — the needs-setup CTA', () => {
  it('leads with the service and a link to the External APIs page', async () => {
    const onOpenExternals = vi.fn();
    render(
      <GuardSectionDetail
        section={section()}
        onOpenFlow={() => {}}
        onOpenExternals={onOpenExternals}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('needs setup: open-meteo')).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /Provide open-meteo/ });
    expect(cta).toHaveTextContent('External APIs');
    expect(cta.className).toContain('orange');
    expect(cta.className).toContain('dark:text-orange-300');
    await userEvent.click(cta);
    expect(onOpenExternals).toHaveBeenCalledTimes(1);
  });

  it('the provided sub-state offers the COMMAND instead of the link', () => {
    render(
      <GuardSectionDetail
        section={section({ needsSetup: { services: [], provided: ['open-meteo'] } })}
        onOpenFlow={() => {}}
        onOpenExternals={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('truecourse guard generate')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Provide/ })).not.toBeInTheDocument();
  });

  it('a plain blocked section gets no CTA at all', () => {
    render(
      <GuardSectionDetail
        section={section({ status: 'blocked-on', needsSetup: undefined, blockedOnCapabilities: ['external-service'] })}
        onOpenFlow={() => {}}
        onOpenExternals={() => {}}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: /Provide/ })).not.toBeInTheDocument();
    expect(screen.getByText('external-service')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The link target, and the tally the strip renders.
// ---------------------------------------------------------------------------

function ExternalsJumpHarness() {
  const { openGuardExternals } = useGuardView();
  const loc = useLocation();
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <button type="button" onClick={openGuardExternals}>
        go
      </button>
    </div>
  );
}

describe('the CTA target', () => {
  it('lands the Guard section’s External APIs tab, carrying no stale selection', async () => {
    render(
      <MemoryRouter initialEntries={['/repos/r?section=guard&tab=coverage&gflow=f1']}>
        <ExternalsJumpHarness />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'go' }));
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('section=guard');
    expect(search).toContain('tab=externals');
    expect(search).not.toContain('gflow=');
  });
});

describe('tallyNeedsSetup — the per-service breakdown behind the chip', () => {
  it('counts one per section, still-to-provide first, then by count and name', () => {
    expect(
      tallyNeedsSetup([
        { services: ['open-meteo'], provided: [] },
        { services: ['open-meteo'], provided: ['stripe'] },
        { services: [], provided: ['stripe'] },
        { services: ['acme'], provided: [] },
        undefined,
      ]),
    ).toEqual([
      { service: 'open-meteo', count: 2, provided: false },
      { service: 'acme', count: 1, provided: false },
      { service: 'stripe', count: 2, provided: true },
    ]);
  });

  it('a service seen both ways is still-to-provide — something is genuinely missing', () => {
    expect(
      tallyNeedsSetup([
        { services: [], provided: ['open-meteo'] },
        { services: ['open-meteo'], provided: [] },
      ]),
    ).toEqual([{ service: 'open-meteo', count: 2, provided: false }]);
  });
});
