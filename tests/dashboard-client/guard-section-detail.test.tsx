/**
 * The section detail pane for a section carrying birth findings / authoring errors:
 * it lists its birth findings (expandable to expected → actual) and deduped authoring
 * errors — above whatever committed scenarios the section has. Since item 15 a finding
 * no longer withholds committed siblings, so a finding can ride a committed (guarded /
 * run) section as context, and a section that committed NOTHING shows only its findings
 * instead of the bare "no scenario" EmptyState.
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
  it('lists the findings of a section that committed nothing (no EmptyState)', () => {
    renderDetail(
      section({
        status: 'finding',
        reason: '1 birth finding awaiting a decision',
        findings: [{ index: 3, title: 'exit code drifted', step: 2, expected: 'exit 0', actual: 'exit 2' }],
      }),
    );

    expect(screen.getByText('exit code drifted')).toBeInTheDocument();
    expect(screen.getByText('1 birth finding awaiting a decision')).toBeInTheDocument();
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

  it('shows the triage verdict chip on a finding row', () => {
    renderDetail(
      section({
        status: 'finding',
        findings: [
          { index: 0, title: 'exit code drifted', step: 2, expected: 'exit 0', actual: 'exit 2', triageVerdict: 'code-drift' },
        ],
      }),
    );
    expect(screen.getByText('code drift')).toBeInTheDocument();
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

  it('shows a finding as context on a committed (guarded) section — item 15', () => {
    renderDetail(
      section({
        status: 'guarded',
        scenarioIds: ['config-nesting.1'],
        // A committed section that also left a sibling finding — the finding rides
        // alongside the committed scenario, never withholds it.
        findings: [{ index: 0, title: 'exit code drifted', step: 2, expected: 'exit 0', actual: 'exit 2' }],
      }),
    );

    // Both the finding AND the committed scenario id render — outcome + finding together.
    expect(screen.getByText('exit code drifted')).toBeInTheDocument();
    expect(screen.getByText('config-nesting.1')).toBeInTheDocument();
    expect(screen.queryByText(/no scenario/i)).not.toBeInTheDocument();
  });

  it('lists deduped authoring errors with attempt counts for an authoring-error section (no EmptyState)', () => {
    renderDetail(
      section({
        status: 'authoring-error',
        reason: 'authoring failed — 3 attempts; re-run generate to retry',
        authoringErrors: [
          { message: 'timed out after 10m', attempts: 2 },
          { message: 'invalid output twice', attempts: 1 },
        ],
      }),
    );

    expect(screen.getByText('authoring failed — 3 attempts; re-run generate to retry')).toBeInTheDocument();
    expect(screen.getByText('timed out after 10m')).toBeInTheDocument();
    expect(screen.getByText('invalid output twice')).toBeInTheDocument();
    expect(screen.getByText('2 attempts')).toBeInTheDocument();
    expect(screen.getByText('1 attempt')).toBeInTheDocument();
    expect(screen.getByText('Authoring errors')).toBeInTheDocument();
    expect(screen.queryByText(/no scenario/i)).not.toBeInTheDocument();
  });

  it('lists sibling authoring errors as blocker context on a finding section', () => {
    renderDetail(
      section({
        status: 'finding',
        findings: [{ index: 0, title: 'exit code drifted', step: 2, expected: 'exit 0', actual: 'exit 2' }],
        authoringErrors: [{ message: 'sibling timed out', attempts: 1 }],
      }),
    );

    expect(screen.getByText('exit code drifted')).toBeInTheDocument();
    expect(screen.getByText('sibling timed out')).toBeInTheDocument();
    expect(screen.getByText('Blocking authoring errors')).toBeInTheDocument();
  });

  // Item 14: a section whose only finding was auto-resolved paints by its gap/unguarded
  // status (never red `finding`); the auto-resolved entry rides as MUTED context.
  it('shows auto-resolved entries as muted context, not a red finding, under an unguarded section', () => {
    renderDetail(
      section({
        status: 'unguarded',
        autoResolved: [
          { index: 0, kind: 'triage-resolve', title: 'bad flag scenario', detail: 'used the wrong subcommand', verdict: 'generation-defect' },
        ],
      }),
    );

    expect(screen.getByText('Auto-resolved · no task')).toBeInTheDocument();
    expect(screen.getByText('bad flag scenario')).toBeInTheDocument();
    expect(screen.getByText('used the wrong subcommand')).toBeInTheDocument();
    expect(screen.getByText('generation-defect')).toBeInTheDocument();
    // The muted-context section suppresses the "no scenario" EmptyState.
    expect(screen.queryByText(/no scenario/i)).not.toBeInTheDocument();
  });
});
