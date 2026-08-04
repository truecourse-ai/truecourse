import { describe, it, expect } from 'vitest';
import {
  GUARD_COVERAGE_STATUS_PRECEDENCE,
  GuardFlowScenarioRowSchema,
  GuardFlowSurfaceSchema,
  GuardSectionCoverageStatusSchema,
  GuardCoverageGapKindSchema,
  GuardOutcomeSchema,
  awaitingDriverIds,
  guardResultStage,
  isManualFlowId,
  manualFlowId,
  manualFlowScenarioId,
  worstCoverageStatus,
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

  it('lets a run outcome beat a generate-time verdict', () => {
    expect(worstCoverageStatus(['pass', 'guarded'])).toBe('pass');
    expect(worstCoverageStatus(['pass', 'no-journey'])).toBe('pass');
    expect(worstCoverageStatus(['fail', 'pass', 'web'])).toBe('fail');
    expect(worstCoverageStatus(['stale', 'orphaned'])).toBe('stale');
  });

  it('orders guarded above gaps, and gaps above unguarded', () => {
    expect(worstCoverageStatus(['guarded', 'untestable'])).toBe('guarded');
    expect(worstCoverageStatus(['web', 'untestable'])).toBe('web');
    expect(worstCoverageStatus(['no-claim', 'unguarded'])).toBe('no-claim');
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
    expect(row.journeyPath).toEqual([]);
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
