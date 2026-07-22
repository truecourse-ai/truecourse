/**
 * The section detail pane. The run outcomes lead (a committed failing scenario paints
 * red and carries its generate-time diagnosis — the triage verdict + recommendation —
 * one keypress away). Beneath them ride the quiet context: deduped authoring errors,
 * the muted tool-defect residue (weak/undecidable candidates re-authored next generate,
 * never red drift, expandable to expected → actual), and the auto-resolved ledger. None
 * withholds a committed sibling; a section that committed NOTHING shows only its residue
 * instead of the bare "no scenario" EmptyState.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GuardSectionCoverage, GuardSectionScenario } from '@truecourse/shared';
import { GuardSectionDetail } from '@/components/guard/GuardSectionDetail';

function section(over: Partial<GuardSectionCoverage>): GuardSectionCoverage {
  return {
    anchor: 'config-nesting',
    headingText: 'Nesting',
    level: 3,
    fingerprint: 'sha256:x',
    status: 'unguarded',
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
  it('lists the tool-defect residue of a section that committed nothing (no EmptyState)', () => {
    renderDetail(
      section({
        status: 'unguarded',
        reason: '1 weak candidate — re-authored next generate',
        findings: [{ index: 3, title: 'exit code drifted', step: 2, expected: 'exit 0', actual: 'exit 2' }],
      }),
    );

    expect(screen.getByText('exit code drifted')).toBeInTheDocument();
    // The muted residue rides under its own quiet group header, never a red finding.
    expect(screen.getByText('Tool defects · re-authored next generate')).toBeInTheDocument();
    expect(screen.getByText('1 weak candidate — re-authored next generate')).toBeInTheDocument();
    expect(screen.queryByText(/no scenario/i)).not.toBeInTheDocument();
  });

  it('expands a finding row to its expected → actual on click', async () => {
    renderDetail(
      section({
        status: 'unguarded',
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
        status: 'unguarded',
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
        status: 'unguarded',
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
        status: 'unguarded',
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

// Item 3: a committed FAILING scenario carries its generate-time diagnosis (the triage
// verdict + recommendation the run itself can't derive). The failing row exposes it one
// keypress away — expand the row to reveal the run failure detail AND the diagnosis.
describe('GuardSectionDetail — committed failing scenario diagnosis (item 3)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const failing: GuardSectionScenario = {
    id: 's1',
    title: 'login rate limits',
    outcome: 'fail',
    durationMs: 5,
    failure: { step: 2, expected: 'exit 1', actual: 'exit 0' },
    diagnosis: {
      step: 2,
      expected: 'exit 1',
      actual: 'exit 0',
      triage: {
        verdict: 'code-drift',
        confidence: 'high',
        brief: 'The program exits 0 where the section promises exit 1.',
        recommendation: 'Fix the command to exit 1, or update the doc if the new behavior is intended.',
      },
    },
  };

  it('shows the diagnosis triage verdict + recommendation on the expanded failing row', async () => {
    // The expanded row fetches its YAML source; stub it so the source read resolves.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    renderDetail(section({ status: 'fail', scenarioIds: ['s1'], scenarios: [failing] }));

    // Collapsed → the diagnosis is hidden until the row is opened.
    expect(screen.queryByText(failing.diagnosis!.triage!.recommendation)).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('login rate limits'));

    // The triage verdict chip + its recommendation are now one keypress away.
    expect(screen.getByText('code drift')).toBeInTheDocument();
    expect(screen.getByText(failing.diagnosis!.triage!.recommendation)).toBeInTheDocument();
  });

  it('falls back to the diagnosis expected/actual when the run left no failure detail', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    // A committed drift scenario with a diagnosis but no run failure detail (e.g. not
    // re-run) still surfaces the generate-time expected/actual.
    const noFailure: GuardSectionScenario = { ...failing, failure: undefined };
    renderDetail(section({ status: 'fail', scenarioIds: ['s1'], scenarios: [noFailure] }));

    await userEvent.click(screen.getByText('login rate limits'));
    expect(screen.getByText('exit 1')).toBeInTheDocument();
    expect(screen.getByText('exit 0')).toBeInTheDocument();
    expect(screen.getByText('code drift')).toBeInTheDocument();
  });
});
