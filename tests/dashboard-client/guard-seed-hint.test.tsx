/**
 * The SEED hint in the UI (item 66). A section blocked on missing data has exactly
 * one action, and which one depends on whether a seed exists yet:
 *   no seed  → plain `blocked-on`, and the hint offers `guard seed --init`;
 *   a seed   → the core read path promotes the gap to needs-setup's "setup done"
 *              sub-state, whose action is the re-generate COMMAND — and the hint
 *              must not also appear (there is nothing left to draft).
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

  it('names the synthetic key "seed data", never `missing-data`', () => {
    expect(guardSetupServiceLabel('missing-data')).toBe('seed data');
    expect(guardSetupServiceLabel('open-meteo')).toBe('open-meteo');
    expect(guardNeedsSetupNeed({ services: [], provided: ['missing-data'] })).toBe(
      'seed data is set up — re-run guard generate to author these flows',
    );
  });
});
