/**
 * A section's header: ONE status, said once. The badge carries the dot and the
 * word; nothing beside it paints a second dot for the same state.
 */

import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { GuardSectionCoverage } from '@/preview/vendor/shared';
import { GuardSectionDetail } from '@/preview/vendor/components/guard/GuardSectionDetail';

const section = (over: Partial<GuardSectionCoverage> = {}): GuardSectionCoverage => ({
  anchor: 'cancel',
  headingText: 'Cancel a booking',
  level: 2,
  fingerprint: 'sha256:x',
  status: 'blocked-on',
  reason: 'blocked on credentials: cancel a booking',
  flows: [],
  scenarioIds: [],
  scenarios: [],
  ...over,
});

const noop = () => {};

function renderDetail(over: Partial<GuardSectionCoverage> = {}) {
  return render(
    <GuardSectionDetail repoId="r" section={section(over)} onOpenFlow={noop} onClose={noop} />,
  );
}

/** The header block: the row carrying the section's title. */
function header(): HTMLElement {
  return screen.getByRole('heading', { name: 'Cancel a booking' }).closest('div.border-b') as HTMLElement;
}

describe('the section detail header', () => {
  it('paints one dot for one status', () => {
    renderDetail();
    expect(header().querySelectorAll('.rounded-full')).toHaveLength(1);
  });

  it('reads as one row: the badge, the level, then the title', () => {
    renderDetail();
    const row = header();
    expect(within(row).getByText('Blocked')).toBeInTheDocument();
    expect(within(row).getByText('H2')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Close section detail' })).toBeInTheDocument();
  });

  it('keeps one dot whatever the status is', () => {
    renderDetail({ status: 'pass', reason: undefined });
    expect(header().querySelectorAll('.rounded-full')).toHaveLength(1);
    expect(within(header()).getByText('Succeeded')).toBeInTheDocument();
  });
});
