/**
 * The SEED hint in the UI. A section blocked on missing data has exactly
 * one action, and which one depends on where the seed stands:
 *   no seed → plain `blocked-on`, and the hint offers `guard seed --init`;
 *   a seed the last generate never saw → the core read path promotes the gap to
 *     needs-setup's "setup done" sub-state, whose action is the re-generate
 *     COMMAND — and the hint must not also appear (there is nothing left to draft);
 *   a seed that already FED the last generate → the gap survived a run with this
 *     very seed, so the seed doesn't create the data; the banner says so and the
 *     action is EXTENDING the seed script — never "re-run guard generate", which
 *     would only re-derive the same gap from cache.
 * The word for the synthetic service key is "seed data", never `missing-data`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { guardSetupServiceLabel } from '@truecourse/shared';
import type { GuardSectionCoverage } from '@truecourse/shared';
import { GuardSectionDetail } from '@/components/guard/GuardSectionDetail';
import {
  guardNeedsSetupHeadline,
  guardNeedsSetupNeed,
  GUARD_SEED_INIT_COMMAND,
} from '@/lib/guard-flow-status';

afterEach(cleanup);

const REASON = 'blocked on missing-data, an already-cancelled booking: cancel a booking';

const section = (over: Partial<GuardSectionCoverage> = {}): GuardSectionCoverage => ({
  anchor: 'cancel',
  headingText: 'Cancel a booking',
  level: 2,
  fingerprint: 'sha256:x',
  status: 'blocked-on',
  reason: REASON,
  blockedOnCapabilities: ['missing-data', 'an already-cancelled booking'],
  flows: [],
  scenarioIds: [],
  scenarios: [],
  ...over,
});

const noop = () => {};

describe('the missing-data seed hint', () => {
  it('offers `guard seed --init` on a section blocked on missing data', () => {
    render(<GuardSectionDetail section={section()} onOpenFlow={noop} onClose={noop} />);

    expect(screen.getByText(/No seed script yet/)).toBeTruthy();
    expect(screen.getByText(GUARD_SEED_INIT_COMMAND)).toBeTruthy();
  });

  it('is silent on a section blocked on anything else', () => {
    render(
      <GuardSectionDetail
        section={section({
          reason: 'blocked on stripe: charge a card',
          blockedOnCapabilities: ['stripe'],
        })}
        onOpenFlow={noop}
        onClose={noop}
      />,
    );

    expect(screen.queryByText(/No seed script yet/)).toBeNull();
  });

  it('is silent — and the CTA is the re-generate command — once a seed exists', () => {
    render(
      <GuardSectionDetail
        section={section({
          status: 'needs-setup',
          // What `readGuardExternalSetupIndex` derives once `api.seed` is declared.
          needsSetup: { services: [], provided: ['missing-data'] },
        })}
        onOpenFlow={noop}
        onClose={noop}
      />,
    );

    expect(screen.queryByText(/No seed script yet/)).toBeNull();
    // The banner's own sentence — "seed data", never `missing-data`, and never
    // dressed as a third party someone signs up for.
    expect(
      screen.getByText(guardNeedsSetupHeadline({ services: [], provided: ['missing-data'] })),
    ).toBeTruthy();
    expect(screen.getByText(/^seed data is already set up/)).toBeTruthy();
    expect(screen.getByText('truecourse guard generate')).toBeTruthy();
  });

  it('says the seed is INSUFFICIENT — never "already set up" — when it fed the last generate', () => {
    render(
      <GuardSectionDetail
        section={section({
          status: 'needs-setup',
          // What `readGuardExternalSetupIndex` derives when the recipe fingerprint
          // has not moved since the generate that recorded the gap.
          needsSetup: { services: ['missing-data'], provided: [] },
        })}
        onOpenFlow={noop}
        onClose={noop}
      />,
    );

    expect(screen.queryByText(/No seed script yet/)).toBeNull();
    expect(screen.queryByText(/already set up/)).toBeNull();
    expect(
      screen.getByText(guardNeedsSetupHeadline({ services: ['missing-data'], provided: [] })),
    ).toBeTruthy();
    expect(screen.getByText(/the seed script ran, but doesn’t create the data/)).toBeTruthy();
    // The action is editing the seed, then re-generating — never the externals page.
    expect(screen.getByText(/Extend the seed script to create it/)).toBeTruthy();
    expect(screen.getByText('truecourse guard generate')).toBeTruthy();
    expect(screen.queryByText(/External APIs/)).toBeNull();
  });

  it('names the synthetic key "seed data", never `missing-data`', () => {
    expect(guardSetupServiceLabel('missing-data')).toBe('seed data');
    expect(guardSetupServiceLabel('open-meteo')).toBe('open-meteo');
    expect(guardNeedsSetupNeed({ services: [], provided: ['missing-data'] })).toBe(
      'seed data is set up — re-run guard generate to author these flows',
    );
  });
});
