/**
 * NEEDS SETUP in the UI — the blocked gap that is a to-do.
 *
 * Three things must be true wherever it renders: it is told APART from a failure
 * and from the grey blocked wall (its own word, its own orange paint, in both
 * themes), it NAMES the third party, and it carries the one action that clears it
 * — a link to the named service's card on the External APIs page, or, once the
 * account exists, the re-generate command instead.
 *
 * "Wherever" is ONE component (`GuardNeedsSetupCta`) on both surfaces that host
 * it: the section side panel and a flow detail's why-no-test row.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type {
  GuardFlowDetail as GuardFlowDetailData,
  GuardFlowGap,
  GuardNeedsSetup,
  GuardSectionCoverage,
  GuardSectionCoverageStatus,
} from '@truecourse/shared';
import { MISSING_DATA_NOUN } from '@truecourse/shared';
import { GuardFlowDetail } from '@/components/guard/GuardFlowDetail';
import { GuardSectionDetail } from '@/components/guard/GuardSectionDetail';
import { GuardTotalsStrip } from '@/components/guard/GuardTotalsStrip';
import { GuardSurfaceChip } from '@/components/guard/GuardSurfaceChip';
import { useGuardView } from '@/hooks/useGuardView';
import {
  GUARD_NEEDS_SETUP_NEXT,
  guardGapNeed,
  guardNeedsSetupCta,
  guardNeedsSetupHeadline,
  guardNeedsSetupNeed,
  guardProvideServiceCta,
  guardStatusLabel,
  guardStatusWord,
  guardWhyNoTest,
} from '@/lib/guard-flow-status';
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
  it('wears the Blocked word like every blocker — its SERVICES are what set it apart', () => {
    // It is a to-do a user can clear, which is exactly what Blocked means; a sixth
    // status word for it would be the vocabulary leak the five words removed.
    expect(guardStatusWord('needs-setup')).toBe('Blocked');
    expect(guardStatusLabel('needs-setup')).toBe('Blocked');
    expect(guardStatusWord('blocked-on')).toBe('Blocked');
    // What tells the two apart is its own colour and the CTA it can render.
    expect(guardStatusMeta('needs-setup').badge).not.toBe(guardStatusMeta('blocked-on').badge);
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

  /**
   * The banner has room for a SENTENCE, and "needs setup: apple and googleapis"
   * is a label — it never says what is going on or that the reader can clear it.
   * The compact phrase stays for the chips; this is its long form.
   */
  it('has a full-sentence headline for the banner, and keeps the compact phrase for chips', () => {
    expect(guardNeedsSetupHeadline({ services: ['open-meteo'], provided: [] })).toBe(
      'Not testable yet — open-meteo is an external service that needs an account before guard can test against it.',
    );
    expect(guardNeedsSetupHeadline({ services: ['apple', 'googleapis'], provided: [] })).toBe(
      'Not testable yet — apple and googleapis are external services that need accounts before guard can test against them.',
    );
    // Seed data is not a third party anyone signs up for — it never reads as one.
    // An OUTSTANDING seed noun only exists when a seed already fed the last
    // generate, so the sentence is the generator's verdict, not a setup ask.
    expect(guardNeedsSetupHeadline({ services: [MISSING_DATA_NOUN], provided: [] })).toBe(
      'Not testable yet — the seed script ran, but doesn’t create the data this flow needs.',
    );
    expect(guardNeedsSetupHeadline({ services: ['apple', MISSING_DATA_NOUN], provided: [] })).toBe(
      'Not testable yet — apple is an external service that needs an account before guard can test against it.' +
        ' It also needs data the seed script doesn’t create yet.',
    );
    // The done sub-state states the FACT; the command beneath it is the action.
    expect(guardNeedsSetupHeadline({ services: [], provided: ['open-meteo'] })).toBe(
      'open-meteo is already set up — these tests just haven’t been authored since.',
    );
    expect(guardNeedsSetupHeadline({ services: [], provided: ['apple', 'googleapis'] })).toBe(
      'apple and googleapis are already set up — these tests just haven’t been authored since.',
    );
    // The one-line contexts (chips, journey needs, section flow rows) are untouched.
    expect(guardNeedsSetupNeed({ services: ['apple', 'googleapis'], provided: [] })).toBe(
      'needs setup: apple and googleapis',
    );
    // …except the seed-only case: "needs setup: seed data" would send the reader
    // to a page with no row for it, so the chip states the actual need.
    expect(guardNeedsSetupNeed({ services: [MISSING_DATA_NOUN], provided: [] })).toBe(
      'needs data the seed script doesn’t create yet',
    );
    // …and it survives the capitalize-and-period the why-no-test row applies.
    expect(guardWhyNoTest(NEEDS_SETUP_GAP)).toBe('Needs setup: open-meteo.');
  });

  it('the follow-up line adds what the headline leaves out, and never restates it', () => {
    expect(GUARD_NEEDS_SETUP_NEXT).toBe(
      'A real or sandbox account both work — provide one, then re-run `truecourse guard generate` to author these tests.',
    );
  });

  it('has a per-SERVICE CTA phrase — the words of a link that opens one card', () => {
    expect(guardProvideServiceCta('open-meteo')).toBe('Provide open-meteo');
    // The synthetic key is not a third party and must not read like one.
    expect(guardProvideServiceCta(MISSING_DATA_NOUN)).toBe('Provide seed data');
    // The whole-list phrasing stays — it is the fallback, not the link.
    expect(guardNeedsSetupCta({ services: ['open-meteo', 'stripe'], provided: [] })).toBe(
      'Provide open-meteo and stripe',
    );
    // Seed-only: the action is editing the seed script, never the externals page.
    expect(guardNeedsSetupCta({ services: [MISSING_DATA_NOUN], provided: [] })).toBe(
      'Extend the seed script',
    );
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

  it('counts into the ONE Blocked chip — a counter is a status, not a triage', () => {
    renderStrip();
    const strip = screen.getByRole('group', { name: 'Coverage totals' });
    const chips = within(strip)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(chips).toEqual(['5Blocked', '1Succeeded']);
    expect(chips).not.toContain('3Needs setup');
  });

  it('expands into per-service rows when it is the active filter', () => {
    renderStrip({ activeFilter: 'blocked' });
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
    renderStrip({ activeFilter: 'blocked' }, onOpenExternals);
    await userEvent.click(
      within(screen.getByRole('group', { name: 'Needs setup' })).getByRole('button'),
    );
    expect(onOpenExternals).toHaveBeenCalledTimes(1);
  });

  it('the ALREADY-PROVIDED sub-state says re-generate, not "provide"', () => {
    renderStrip({
      activeFilter: 'blocked',
      needsSetupServices: [{ service: 'open-meteo', count: 2, provided: true }],
    });
    const expansion = screen.getByRole('group', { name: 'Needs setup' });
    expect(within(expansion).getByText('· re-generate')).toBeInTheDocument();
    expect(
      within(expansion).getByText(/run `truecourse guard generate` to author these flows/),
    ).toBeInTheDocument();
    expect(within(expansion).queryByText(/Provide these/)).not.toBeInTheDocument();
  });

  it('shows no expansion when another status is the active filter', () => {
    renderStrip({ activeFilter: 'succeeded' });
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
    expect(screen.getByText(guardNeedsSetupHeadline(section().needsSetup!))).toBeInTheDocument();
    const cta = screen.getByRole('button', { name: /Provide open-meteo/ });
    expect(cta).toHaveTextContent('External APIs');
    expect(cta.className).toContain('orange');
    expect(cta.className).toContain('dark:text-orange-300');
    await userEvent.click(cta);
    expect(onOpenExternals).toHaveBeenCalledWith('open-meteo');
  });

  // The panel and the flow row are ONE component, so the per-service split
  // reaches both — this is the section side of the same rule.
  it('gives every outstanding service its own link here too', async () => {
    const onOpenExternals = vi.fn();
    render(
      <GuardSectionDetail
        section={section({ needsSetup: { services: ['open-meteo', 'stripe'], provided: [] } })}
        onOpenFlow={() => {}}
        onOpenExternals={onOpenExternals}
        onClose={() => {}}
      />,
    );
    const links = screen.getAllByRole('button', { name: /Provide/ });
    expect(links).toHaveLength(2);
    await userEvent.click(links[1]);
    expect(onOpenExternals).toHaveBeenCalledWith('stripe');
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
// The flow detail — the same CTA on the why-no-test row.
// ---------------------------------------------------------------------------

const flowDetail = (needsSetup: GuardNeedsSetup): GuardFlowDetailData => ({
  flowId: 'weather/forecast',
  title: 'The forecast is shown for a city',
  goal: 'Search a city and read its forecast',
  status: 'needs-setup',
  bucket: 'blocked',
  epic: false,
  manual: false,
  composedOf: [],
  fingerprint: 'sha256:x',
  milestones: [],
  surfaces: [
    {
      surface: 'api',
      status: 'needs-setup',
      birthPassed: false,
      hasEvidence: false,
      journeyPath: [],
      gap: { ...NEEDS_SETUP_GAP, needsSetup },
    },
  ],
  gaps: [],
  journeyIds: [],
  findings: [],
  errors: [],
  generatedAt: '2026-07-29T10:00:00.000Z',
  runId: null,
  ranAt: null,
});

describe('GuardFlowDetail — the needs-setup why-no-test row', () => {
  const renderDetail = (
    needsSetup: GuardNeedsSetup,
    onOpenExternals?: (service?: string) => void,
  ) =>
    render(
      <GuardFlowDetail
        detail={flowDetail(needsSetup)}
        onOpenSpec={() => {}}
        onOpenTest={() => {}}
        onOpenJourney={() => {}}
        {...(onOpenExternals ? { onOpenExternals } : {})}
      />,
    );

  it('carries the service, the explainer and the link — not a bare three-word label', () => {
    const needsSetup = { services: ['open-meteo'], provided: [] };
    renderDetail(needsSetup);
    const row = within(screen.getByRole('list', { name: 'Tests' })).getAllByRole('listitem')[0];
    // The full sentence, not the chip's compact phrase.
    expect(within(row).getByText(guardNeedsSetupHeadline(needsSetup))).toBeInTheDocument();
    expect(within(row).queryByText(guardNeedsSetupNeed(needsSetup))).not.toBeInTheDocument();
    // …and the one line it leaves out, which never restates it.
    expect(within(row).getByText(GUARD_NEEDS_SETUP_NEXT)).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /Provide open-meteo/ })).toHaveTextContent(
      'External APIs',
    );
    // It stays visually apart from a real test row, and never says the same thing
    // twice — the CTA's own sentence replaces the why-no-test line.
    expect(row.className).toContain('orange');
    expect(
      within(row).queryByText(guardWhyNoTest(NEEDS_SETUP_GAP)),
    ).not.toBeInTheDocument();
  });

  it('the link names the SERVICE, so it lands on that card', async () => {
    const onOpenExternals = vi.fn();
    renderDetail({ services: ['open-meteo'], provided: [] }, onOpenExternals);
    await userEvent.click(screen.getByRole('button', { name: /Provide open-meteo/ }));
    expect(onOpenExternals).toHaveBeenCalledWith('open-meteo');
  });

  /**
   * A link opens exactly ONE card, so N outstanding services need N links —
   * a single "Provide open-meteo and stripe" button could only ever reach the
   * first, leaving the rest of the to-do with no way in.
   */
  it('gives every outstanding service its OWN link', async () => {
    const onOpenExternals = vi.fn();
    renderDetail({ services: ['open-meteo', 'stripe'], provided: [] }, onOpenExternals);
    const row = within(screen.getByRole('list', { name: 'Tests' })).getAllByRole('listitem')[0];
    const links = within(row).getAllByRole('button', { name: /Provide/ });
    expect(links.map((b) => b.textContent)).toEqual([
      'Provide open-meteo→ External APIs',
      'Provide stripe→ External APIs',
    ]);
    // The sentence above still reads as ONE phrase — only the ACTION splits.
    expect(
      within(row).getByText(guardNeedsSetupHeadline({ services: ['open-meteo', 'stripe'], provided: [] })),
    ).toBeInTheDocument();

    await userEvent.click(links[0]);
    await userEvent.click(links[1]);
    expect(onOpenExternals.mock.calls).toEqual([['open-meteo'], ['stripe']]);
  });

  it('never links the synthetic seed-data key — the action is extending the seed script', () => {
    const onOpenExternals = vi.fn();
    renderDetail({ services: [MISSING_DATA_NOUN], provided: [] }, onOpenExternals);
    // No External APIs button at all: the page has no card for a seed, and the
    // gap means the existing seed doesn't create this data — the line says so.
    expect(screen.queryByRole('button', { name: /Provide/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Extend the seed script to create it/)).toBeInTheDocument();
    // …and the account explainer never shows — there is no account to provide.
    expect(screen.queryByText(GUARD_NEEDS_SETUP_NEXT)).not.toBeInTheDocument();
  });

  it('the provided sub-state offers the command, and no explainer that contradicts it', () => {
    renderDetail({ services: [], provided: ['open-meteo'] });
    expect(screen.getByText('truecourse guard generate')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Provide/ })).not.toBeInTheDocument();
    expect(screen.queryByText(GUARD_NEEDS_SETUP_NEXT)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// The link target, and the tally the strip renders.
// ---------------------------------------------------------------------------

function ExternalsJumpHarness({ service }: { service?: string }) {
  const { openGuardExternals } = useGuardView();
  const loc = useLocation();
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <button type="button" onClick={() => openGuardExternals(service)}>
        go
      </button>
    </div>
  );
}

describe('the CTA target', () => {
  const jump = (service?: string, entry = '/repos/r?section=guard&tab=coverage&gflow=f1') => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <ExternalsJumpHarness {...(service ? { service } : {})} />
      </MemoryRouter>,
    );
    return userEvent.click(screen.getByRole('button', { name: 'go' }));
  };

  it('lands the Guard section’s External APIs tab, carrying no stale selection', async () => {
    await jump();
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('section=guard');
    expect(search).toContain('tab=externals');
    expect(search).not.toContain('gflow=');
    // No service named ⇒ no selection: the page is the whole card list.
    expect(search).not.toContain('gext=');
  });

  it('carries the named service as `gext`, so the page opens that card', async () => {
    await jump('open-meteo');
    expect(screen.getByTestId('search').textContent).toContain('gext=open-meteo');
  });

  it('drops a stale `gext` like every other guard selection', async () => {
    await jump(undefined, '/repos/r?section=guard&tab=externals&gext=stripe');
    expect(screen.getByTestId('search').textContent).not.toContain('gext=');
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
