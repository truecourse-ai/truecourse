/**
 * OUR DEFECT vs YOUR DRIFT — the visual distinction the findings surfaces draw.
 *
 * A generate produces two very different kinds of finding, and only ONE of them is
 * news about the repo:
 *
 *   drift   a committed red test — the code and the doc disagree. Red, counted,
 *           reproduced by `guard run`;
 *   defect  a withheld `generation-defect` verdict or a fidelity rejection. WE
 *           wrote a bad test; nothing was committed and nothing in the repo is
 *           broken. It must never paint red, never count as drift, and never make
 *           a flow read "Failing".
 *
 * Beside a failure that IS drift, the triage chip says which kind — code drift or
 * doc drift — with the brief and the concrete unblock behind it.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { GuardBirthFinding, GuardTriage } from '@truecourse/shared';
import { guardFindingClass } from '@truecourse/shared';
import { GuardToolDefectChip } from '@/components/guard/GuardStatusBadge';
import { GuardTriageChip, GUARD_TRIAGE_WORD } from '@/components/guard/GuardTriageChip';
import { GUARD_TOOL_DEFECT_LABEL, guardFlowPlainStatus } from '@/lib/guard-flow-status';

const DOC = 'docs/specs/tasks.md';

const finding =(over: Partial<GuardBirthFinding> = {}): GuardBirthFinding => ({
  doc: DOC,
  anchor: 'tasks/completing-tasks',
  title: 'Completing a task reports it done',
  step: 2,
  expected: 'stdout contains “done”',
  actual: 'Marked t1 as done',
  failedMilestone: 2,
  ...over,
});

/** A committed red test — the repo and the doc disagree. */
const DRIFT = finding({ committed: true, triage: { verdict: 'code-drift', confidence: 'high', brief: 'b', recommendation: 'r' } });
/** A withheld generation defect — ours, never committed. */
const DEFECT = finding({
  triage: { verdict: 'generation-defect', confidence: 'high', brief: 'b', recommendation: 'r' },
});

describe('a withheld defect is never drift', () => {
  it('does not make a flow read "Failed" — only drift-class findings do', () => {
    // The wire splits them: `findings` counts drift, `toolDefects` counts ours.
    expect(guardFlowPlainStatus({ status: 'guarded', bucket: 'guarded', findings: 0 })).toBe('succeeded');
    expect(guardFlowPlainStatus({ status: 'guarded', bucket: 'guarded', findings: 1 })).toBe('failed');
  })

  it('rides as a muted marker, never as a status colour', () => {
    render(<GuardToolDefectChip />);
    const chip = screen.getByText(GUARD_TOOL_DEFECT_LABEL);
    // Muted BACKGROUND, full-contrast text — a marker, never a status colour.
    expect(chip.className).toContain('bg-muted');
    expect(chip.className).toContain('text-foreground');
    expect(chip.className).not.toMatch(/red|amber|orange/);
  });

  it('classifies the two kinds the same way the CLI does', () => {
    expect(guardFindingClass(DRIFT)).toBe('drift');
    expect(guardFindingClass(DEFECT)).toBe('defect');
  });
});

describe('GuardTriageChip — whose fault the failure is, beside the failure', () => {
  const chipFor = (verdict: GuardTriage['verdict']) => {
    const triage: GuardTriage = {
      verdict,
      confidence: 'high',
      brief: 'The doc promises `Completed t1 ✓`; the program prints `Marked t1 as done`.',
      recommendation: 'Fix the message, or update the doc.',
    };
    const { unmount } = render(<GuardTriageChip triage={triage} />);
    const el = screen.getByText(GUARD_TRIAGE_WORD[verdict]);
    const className = el.className;
    unmount();
    return className;
  };

  it('says the verdict in plain words, never the wire id', () => {
    expect(GUARD_TRIAGE_WORD['code-drift']).toBe('code drift');
    expect(GUARD_TRIAGE_WORD['doc-drift']).toBe('doc drift');
    expect(GUARD_TRIAGE_WORD['generation-defect']).toBe('our defect');
  });

  it('takes the failure colour for BOTH drifts and stays muted for our own defect', () => {
    // Both drifts are real work in the repo (fix the code, or fix the doc), so both
    // wear the failure's red. Which one it is, is the WORD's job: there is no third
    // severity colour, and amber is banned outright.
    expect(chipFor('code-drift')).toContain('red');
    expect(chipFor('doc-drift')).toContain('red');
    expect(chipFor('doc-drift')).not.toMatch(/amber|orange/);
    // The whole point: our mistake is never rendered as a broken repo.
    const ours = chipFor('generation-defect');
    expect(ours).toContain('text-muted-foreground');
    expect(ours).not.toMatch(/red|amber/);
  });
});
