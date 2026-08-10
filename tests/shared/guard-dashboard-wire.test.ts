import { describe, it, expect } from 'vitest';
import {
  GUARD_COVERAGE_PLAIN_ORDER,
  GUARD_COVERAGE_STATUS_PRECEDENCE,
  GUARD_COVERAGE_STATUS_WORD,
  GuardFlowScenarioRowSchema,
  GuardFlowSurfaceSchema,
  GuardSectionCoverageStatusSchema,
  GuardCoverageGapKindSchema,
  GuardOutcomeSchema,
  GuardScenarioResultSchema,
  awaitingDriverIds,
  guardCoveragePlainStatus,
  guardCoverageWord,
  guardFlowPlainStatus,
  guardNoFlowClaimGapKind,
  guardResultRanAt,
  guardResultRunId,
  guardResultStage,
  isManualFlowId,
  manualFlowId,
  manualFlowScenarioId,
  worstCoverageStatus,
  worstCoveragePlainStatus,
  type GuardCoveragePlainStatus,
  type GuardFlowListItem,
  type GuardSectionCoverageStatus,
} from '../../packages/shared/src/index';

/**
 * The guard dashboard WIRE contract: the coverage-status precedence every rollup
 * (surface → flow → section) shares, and the Manual pseudo-flow identity the flow
 * drill-down uses to stay total over hand-written scenarios.
 */

describe('coverage status precedence', () => {
  it('ranks every status a coverage read can produce', () => {
    const ranked = new Set<string>(GUARD_COVERAGE_STATUS_PRECEDENCE);
    for (const outcome of GuardOutcomeSchema.options) expect(ranked.has(outcome)).toBe(true);
    for (const driver of awaitingDriverIds) expect(ranked.has(driver)).toBe(true);
    for (const kind of GuardCoverageGapKindSchema.options) {
      // `awaiting-driver` paints under its driver id, never under the kind.
      if (kind === 'awaiting-driver') continue;
      expect(ranked.has(kind)).toBe(true);
    }
    expect(ranked.has('guarded')).toBe(true);
    expect(ranked.has('unguarded')).toBe(true);
    // The Zod enum is the same domain, so a payload can be validated either way.
    expect(GuardSectionCoverageStatusSchema.options).toEqual([...GUARD_COVERAGE_STATUS_PRECEDENCE]);
  });

  it('ranks worst-first by the five words, not by where a status came from', () => {
    // A BLOCKER outranks a sibling that passed: a section with a green scenario and
    // a blocked claim reads Blocked, and its detail keeps both.
    expect(worstCoverageStatus(['pass', 'no-interface'])).toBe('no-interface');
    expect(worstCoverageStatus(['pass', 'never-run'])).toBe('never-run');
    expect(worstCoverageStatus(['fail', 'pass', 'web'])).toBe('fail');
    // Within a tier the more informative status still wins.
    expect(worstCoverageStatus(['pass', 'guarded'])).toBe('pass');
    expect(worstCoverageStatus(['stale', 'orphaned'])).toBe('stale');
  });

  it('puts "not testable" last — it decides only when nothing else applies', () => {
    expect(worstCoverageStatus(['guarded', 'untestable'])).toBe('guarded');
    expect(worstCoverageStatus(['never-run', 'untestable'])).toBe('never-run');
    expect(worstCoverageStatus(['web', 'untestable'])).toBe('web');
    expect(worstCoverageStatus(['no-claim', 'unguarded'])).toBe('unguarded');
    // "could not test" outranks "nothing to test".
    expect(worstCoverageStatus(['dismissed', 'unrealizable'])).toBe('unrealizable');
    expect(worstCoverageStatus(['no-claim', 'blocked-on'])).toBe('blocked-on');
  });

  it('answers unguarded for an empty set and ignores an unknown value', () => {
    expect(worstCoverageStatus([])).toBe('unguarded');
    expect(worstCoverageStatus(['nonsense' as GuardSectionCoverageStatus])).toBe('unguarded');
    expect(worstCoverageStatus(['nonsense' as GuardSectionCoverageStatus, 'guarded'])).toBe('guarded');
  });
});

/**
 * THE FIVE WORDS. Every user-facing coverage status — a doc section, a flow, an
 * overview counter, a filter, a chip — is one of Succeeded / Failed / Blocked /
 * Not testable / Never run, on the CLI and in the dashboard alike.
 */
describe('the five-word coverage vocabulary', () => {
  it('offers exactly five words, worst-first', () => {
    expect([...GUARD_COVERAGE_PLAIN_ORDER]).toEqual([
      'failed',
      'blocked',
      'never-run',
      'succeeded',
      'not-testable',
    ]);
    expect(Object.values(GUARD_COVERAGE_STATUS_WORD).sort()).toEqual([
      'Blocked',
      'Failed',
      'Never run',
      'Not testable',
      'Succeeded',
    ]);
  });

  it('folds EVERY wire status onto one of the five — no status is unnamed', () => {
    for (const status of GUARD_COVERAGE_STATUS_PRECEDENCE) {
      const plain = guardCoveragePlainStatus(status);
      expect(GUARD_COVERAGE_PLAIN_ORDER, status).toContain(plain);
      expect(guardCoverageWord(status), status).toBe(GUARD_COVERAGE_STATUS_WORD[plain]);
    }
  });

  it('derives each of the five from the states that mean it', () => {
    // Succeeded — the claims' scenarios passed (in this run, or when written).
    expect(guardCoverageWord('pass')).toBe('Succeeded');
    expect(guardCoverageWord('guarded')).toBe('Succeeded');
    // Failed — contradicted, or the run could not reach a verdict.
    expect(guardCoverageWord('fail')).toBe('Failed');
    expect(guardCoverageWord('error')).toBe('Failed');
    // Blocked — a flow or gap NAMES a blocker. A stale (or orphaned) bind is
    // Blocked too: it is actionable, never a status of its own.
    expect(guardCoverageWord('stale')).toBe('Blocked');
    expect(guardCoverageWord('orphaned')).toBe('Blocked');
    expect(guardCoverageWord('no-interface')).toBe('Blocked');
    expect(guardCoverageWord('blocked-on')).toBe('Blocked');
    expect(guardCoverageWord('needs-setup')).toBe('Blocked');
    expect(guardCoverageWord('authoring-error')).toBe('Blocked');
    expect(guardCoverageWord('web')).toBe('Blocked');
    // …including the one bucket that used to be mute.
    expect(guardCoverageWord('unguarded')).toBe('Blocked');
    // Not testable — a settled answer nobody can act on.
    expect(guardCoverageWord('untestable')).toBe('Not testable');
    expect(guardCoverageWord('unrealizable')).toBe('Not testable');
    expect(guardCoverageWord('no-claim')).toBe('Not testable');
    expect(guardCoverageWord('dismissed')).toBe('Not testable');
    // Never run — scenarios exist and have never executed.
    expect(guardCoverageWord('never-run')).toBe('Never run');
  });

  it('never says a retired word', () => {
    const words = GUARD_COVERAGE_STATUS_PRECEDENCE.map(guardCoverageWord);
    for (const retired of ['Not generated', 'Guarded', 'Unguarded', 'Orphaned', 'Needs setup']) {
      expect(words, retired).not.toContain(retired);
    }
  });

  it('mixes worst-first, and lets "not testable" decide only when alone', () => {
    // Failed > Blocked > Never run > Succeeded > Not testable.
    expect(worstCoveragePlainStatus(['fail', 'blocked-on', 'never-run', 'pass'])).toBe('failed');
    expect(worstCoveragePlainStatus(['blocked-on', 'never-run', 'pass', 'untestable'])).toBe('blocked');
    expect(worstCoveragePlainStatus(['never-run', 'pass', 'dismissed'])).toBe('never-run');
    expect(worstCoveragePlainStatus(['pass', 'untestable'])).toBe('succeeded');
    expect(worstCoveragePlainStatus(['untestable', 'no-claim', 'dismissed'])).toBe('not-testable');
    // Nothing at all is a HOLE, which is Blocked — never a quiet green.
    expect(worstCoveragePlainStatus([])).toBe('blocked');
  });

  it('words a flow the same way the CLI and the dashboard both read it', () => {
    const flow = (over: Partial<GuardFlowListItem>): Pick<GuardFlowListItem, 'status' | 'bucket' | 'findings'> => ({
      status: 'guarded',
      bucket: 'guarded',
      findings: 0,
      ...over,
    });
    expect(guardFlowPlainStatus(flow({}))).toBe('succeeded');
    // A drift finding decides, even when the surface join lost the failing row.
    expect(guardFlowPlainStatus(flow({ findings: 2 }))).toBe('failed');
    // Generate never reached this flow: Blocked, not a failure and not a pass.
    expect(guardFlowPlainStatus(flow({ status: 'unguarded', bucket: 'ungenerated' }))).toBe('blocked');
    expect(guardFlowPlainStatus(flow({ status: 'never-run' }))).toBe('never-run');
    expect(guardFlowPlainStatus(flow({ status: 'untestable', bucket: 'blocked' }))).toBe('not-testable');
  });
});

/**
 * A no-flow claim's reason is the ONLY record a section whose claims all landed
 * there has, so the kind it states is what that section's status derives from.
 */
describe('no-flow claim reasons → their gap kind', () => {
  const word = (reason: string): string =>
    guardCoverageWord(guardNoFlowClaimGapKind(reason) as GuardSectionCoverageStatus);

  it('reads a missing interface as Blocked, however the sentence leads', () => {
    expect(guardNoFlowClaimGapKind('blocked-on layer 2: no `cli/guard` interface has been derived.')).toBe(
      'no-interface',
    );
    expect(guardNoFlowClaimGapKind('out of the authored interface set — no `cli/spec` interface exists.')).toBe(
      'no-interface',
    );
    expect(word('no interface covers this')).toBe('Blocked');
  });

  it('reads a named blocker as Blocked', () => {
    expect(guardNoFlowClaimGapKind('blocked-on the supplied `llm-transport` dependency.')).toBe('blocked-on');
    expect(guardNoFlowClaimGapKind('needs dotnet-sdk. A supplied dependency with no instance.')).toBe(
      'blocked-on',
    );
    expect(word('Requires network access.')).toBe('Blocked');
  });

  it('reads a settled answer as Not testable', () => {
    expect(guardNoFlowClaimGapKind('unrealizable under the runner isolation rule.')).toBe('unrealizable');
    expect(guardNoFlowClaimGapKind('unobservable via CLI — nothing prints it.')).toBe('untestable');
    // A passing mention of the word "interface" is not a missing interface.
    expect(guardNoFlowClaimGapKind('unrealizable against the target (interface decision `phase-0`).')).toBe(
      'unrealizable',
    );
    expect(word('already realized by another flow; recorded uncovered here.')).toBe('Not testable');
  });

  it('never invents a blocker a reason does not name', () => {
    // The default must be a settled answer: a to-do nothing can clear is worse
    // than an honest "nothing to test here".
    expect(guardNoFlowClaimGapKind('it restates the preamble.')).toBe('untestable');
  });
});

describe('Manual pseudo-flow identity', () => {
  it('round-trips a scenario id through its pseudo-flow id', () => {
    const id = manualFlowId('tasks-help-smoke');
    expect(id).toBe('manual:tasks-help-smoke');
    expect(isManualFlowId(id)).toBe(true);
    expect(manualFlowScenarioId(id)).toBe('tasks-help-smoke');
  });

  it('leaves a synthesized flow id alone', () => {
    expect(isManualFlowId('task-lifecycle')).toBe(false);
    expect(manualFlowScenarioId('task-lifecycle')).toBeNull();
  });

  it('survives a scenario id with dots (the `<flow>.<surface>.<n>` scheme)', () => {
    expect(manualFlowScenarioId(manualFlowId('task-lifecycle.cli.1'))).toBe('task-lifecycle.cli.1');
  });
});

describe('the result STAGE on the read surfaces', () => {
  it('reads an absent stage as `run` — every pre-birth-result snapshot is one', () => {
    expect(guardResultStage({ stage: 'birth' })).toBe('birth');
    expect(guardResultStage({ stage: 'run' })).toBe('run');
    expect(guardResultStage({})).toBe('run');
  });

  it('lets a surface row carry a birth-stage failure with no run outcome', () => {
    const surface = GuardFlowSurfaceSchema.parse({
      surface: 'cli',
      scenarioId: 'flow.cli.1',
      status: 'fail',
      stage: 'birth',
    });
    expect(surface).toMatchObject({ status: 'fail', stage: 'birth' });
    expect(surface.outcome).toBeUndefined();

    const row = GuardFlowScenarioRowSchema.parse({
      surface: 'cli',
      scenarioId: 'flow.cli.1',
      status: 'fail',
      stage: 'birth',
      // A committed test is not green by construction any more.
      birthPassed: false,
      failure: { step: 1, expected: 'exit 0', actual: 'exit 7' },
      hasEvidence: false,
    });
    expect(row).toMatchObject({ birthPassed: false, stage: 'birth' });
    expect(row.interfacePath).toEqual([]);
  });

  it('still parses a row with no stage at all (the pre-change wire shape)', () => {
    const row = GuardFlowScenarioRowSchema.parse({
      surface: 'cli',
      scenarioId: 'flow.cli.1',
      status: 'guarded',
      birthPassed: true,
      hasEvidence: false,
    });
    expect(row.stage).toBeUndefined();
  });
});

describe('the result RUN IDENTITY on a merged board', () => {
  const envelope = { runId: 'run-2', ranAt: '2026-08-09T16:00:00.000Z' };

  it('reads an absent per-row id as the envelope’s — every un-merged row is one', () => {
    expect(guardResultRunId({}, envelope)).toBe('run-2');
    expect(guardResultRanAt({}, envelope)).toBe('2026-08-09T16:00:00.000Z');
  });

  it('prefers the row’s own id — a carried row ran in an earlier run', () => {
    const carried = { runId: 'run-1', ranAt: '2026-08-09T04:58:06.000Z' };
    expect(guardResultRunId(carried, envelope)).toBe('run-1');
    expect(guardResultRanAt(carried, envelope)).toBe('2026-08-09T04:58:06.000Z');
  });

  it('is additive on the wire: an old-shape result parses, a stamped one round-trips', () => {
    const base = {
      id: 'flow.cli.1',
      title: 'X',
      binds: { doc: 'docs/x.md', section: 'x', fingerprint: 'sha256:x' },
      outcome: 'pass',
      durationMs: 4,
    };
    // Written before boards merged — no identity fields at all.
    const old = GuardScenarioResultSchema.parse(base);
    expect(old.runId).toBeUndefined();
    expect(old.ranAt).toBeUndefined();

    const stamped = GuardScenarioResultSchema.parse({
      ...base,
      runId: 'run-1',
      ranAt: '2026-08-09T04:58:06.000Z',
    });
    expect(stamped).toMatchObject({ runId: 'run-1', ranAt: '2026-08-09T04:58:06.000Z' });
  });

  it('lets a flow-detail row name the run that produced it', () => {
    const row = GuardFlowScenarioRowSchema.parse({
      surface: 'cli',
      scenarioId: 'flow.cli.1',
      status: 'fail',
      birthPassed: true,
      hasEvidence: true,
      outcome: 'fail',
      runId: 'run-1',
    });
    expect(row.runId).toBe('run-1');
  });
});
