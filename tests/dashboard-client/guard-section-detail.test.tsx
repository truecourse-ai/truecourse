/**
 * The section detail pane for an UNSETTLED section (status `finding` / `held`):
 * it must list everything bound to the section — birth findings (expandable to
 * expected → actual) and ready-but-held scenarios — instead of the bare
 * "no scenario" EmptyState (the all-or-nothing persist means such a section has
 * no committed scenario to list otherwise).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuardSectionCoverage } from '@truecourse/shared';
import { GuardSectionDetail } from '@/components/guard/GuardSectionDetail';

function section(over: Partial<GuardSectionCoverage>): GuardSectionCoverage {
  return {
    anchor: 'config-nesting',
    headingText: 'Nesting',
    level: 3,
    fingerprint: 'sha256:x',
    status: 'finding',
    scenarioIds: [],
    scenarios: [],
    ...over,
  };
}

function renderDetail(sec: GuardSectionCoverage) {
  return render(
    <GuardSectionDetail repoId="repo1" section={sec} runId={null} hasRun={false} onClose={vi.fn()} />,
  );
}

describe('GuardSectionDetail — unsettled sections', () => {
  it('lists the findings and held scenarios of a finding section (no EmptyState)', () => {
    renderDetail(
      section({
        status: 'finding',
        reason: '1 birth finding awaiting a decision · holds 2 ready scenarios',
        findings: [{ index: 3, title: 'exit code drifted', step: 2, expected: 'exit 0', actual: 'exit 2' }],
        heldScenarios: [
          { id: 'cli-held-one', title: 'held rate limit' },
          { id: 'cli-held-two', title: 'held verbose flag' },
        ],
      }),
    );

    expect(screen.getByText('exit code drifted')).toBeInTheDocument();
    expect(screen.getByText('held rate limit')).toBeInTheDocument();
    expect(screen.getByText('held verbose flag')).toBeInTheDocument();
    expect(screen.getByText('1 birth finding awaiting a decision · holds 2 ready scenarios')).toBeInTheDocument();
    expect(screen.queryByText(/no scenario/i)).not.toBeInTheDocument();
  });

  it('expands a finding row to its expected → actual on click', async () => {
    renderDetail(
      section({
        status: 'finding',
        findings: [{ index: 0, title: 'exit code drifted', step: 2, expected: 'exit 0', actual: 'exit 2' }],
      }),
    );

    expect(screen.queryByText('exit 0')).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('exit code drifted'));
    expect(screen.getByText('exit 0')).toBeInTheDocument();
    expect(screen.getByText('exit 2')).toBeInTheDocument();
    expect(screen.getByText(/step 2/)).toBeInTheDocument();
  });

  it('marks a fidelity finding with its chip', () => {
    renderDetail(
      section({
        status: 'finding',
        findings: [
          { index: 0, kind: 'fidelity', title: 'vacuous check', step: 1, expected: '—', actual: 'does not verify the claim' },
        ],
      }),
    );
    expect(screen.getByText('fidelity')).toBeInTheDocument();
  });

  it('lists held scenarios for a held section (no EmptyState)', () => {
    renderDetail(
      section({
        status: 'held',
        reason: '1 ready scenario held — the section did not settle',
        heldScenarios: [{ id: 'cli-held-one', title: 'held rate limit' }],
      }),
    );

    expect(screen.getByText('held rate limit')).toBeInTheDocument();
    expect(screen.getByText('cli-held-one')).toBeInTheDocument();
    expect(screen.queryByText(/no scenario/i)).not.toBeInTheDocument();
  });
});
