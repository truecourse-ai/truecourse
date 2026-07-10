/**
 * Pure guard-gate decision: `diffGuardRuns` buckets the head run's scenarios
 * against the base run (dismissals excluded first, stale/orphaned pulled aside),
 * and `decideGuardGate` maps a `GuardExecReport` to the Check conclusion —
 * engine-level failures are errors (a broken gate must never silently pass).
 */
import { describe, it, expect } from 'vitest';
import {
  diffGuardRuns,
  decideGuardGate,
  type GuardGateDecision,
} from '../../ee/packages/github-app/src/index';
import {
  dismissedClaimKey,
  GUARD_FORMAT_VERSION,
  type GuardOutcome,
  type GuardScenarioResult,
} from '@truecourse/shared';
import type { GuardExecReport } from '@truecourse/guard-runner';

function scen(
  id: string,
  outcome: GuardOutcome,
  over: Partial<GuardScenarioResult> = {},
): GuardScenarioResult {
  return {
    id,
    title: `claim ${id}`,
    binds: { doc: 'docs/spec.md', section: `sec-${id}`, fingerprint: 'sha256:fp' },
    outcome,
    durationMs: 5,
    ...over,
  };
}

function okReport(scenarios: GuardScenarioResult[]): GuardExecReport {
  const summary = { total: scenarios.length, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 };
  for (const s of scenarios) summary[s.outcome] += 1;
  return {
    status: 'ok',
    latest: {
      run: {
        runId: 'run-1',
        ranAt: '2026-07-10T00:00:00.000Z',
        branch: null,
        commit: 'headsha',
        recipeFingerprint: 'sha256:recipe',
        scenarioFormat: GUARD_FORMAT_VERSION,
      },
      summary,
      scenarios,
      sections: [],
    },
    latestPath: '',
    loadErrors: [],
    manifest: null,
  };
}

const none: ReadonlySet<string> = new Set();

describe('diffGuardRuns', () => {
  it('buckets a base-pass head-fail scenario as newly failing', () => {
    const d = diffGuardRuns(
      { base: [scen('a', 'pass')], head: [scen('a', 'fail')], dismissed: none }
    );
    expect(d.newlyFailing.map((s) => s.id)).toEqual(['a']);
    expect(d.preExisting).toHaveLength(0);
    expect(d.resolved).toHaveLength(0);
  });

  it('a head error counts as failing, same as fail', () => {
    const d = diffGuardRuns(
      { base: [scen('a', 'pass')], head: [scen('a', 'error')], dismissed: none }
    );
    expect(d.newlyFailing.map((s) => s.id)).toEqual(['a']);
  });

  it('a new scenario (no base counterpart) failing on head is pre-existing, never newly failing', () => {
    // Acceptance criterion: the Check fails ONLY on pass-on-base → fail-on-head.
    // With no base counterpart there is no base evidence this PR broke it (the
    // stored baseline may simply predate a corpus regeneration that added the
    // scenario) — do not blame the PR.
    const d = diffGuardRuns(
      { base: [], head: [scen('new', 'fail')], dismissed: none }
    );
    expect(d.newlyFailing).toHaveLength(0);
    expect(d.preExisting.map((s) => s.id)).toEqual(['new']);
  });

  it('a new scenario passing on head lands in no bucket', () => {
    const d = diffGuardRuns(
      { base: [], head: [scen('new', 'pass')], dismissed: none }
    );
    expect(d.newlyFailing).toHaveLength(0);
    expect(d.preExisting).toHaveLength(0);
    expect(d.resolved).toHaveLength(0);
    expect(d.stale).toHaveLength(0);
    expect(d.excluded).toHaveLength(0);
  });

  it('fail on both sides is pre-existing, not newly failing', () => {
    const d = diffGuardRuns(
      { base: [scen('a', 'fail')], head: [scen('a', 'fail')], dismissed: none }
    );
    expect(d.preExisting.map((s) => s.id)).toEqual(['a']);
    expect(d.newlyFailing).toHaveLength(0);
  });

  it('a head failure whose base was stale/orphaned (never executed) is pre-existing', () => {
    // No base evidence it passed, and the PR did not introduce it — do not blame the PR.
    const d = diffGuardRuns(
      {
        base: [scen('a', 'stale'), scen('b', 'orphaned')],
        head: [scen('a', 'fail'), scen('b', 'error')],
        dismissed: none,
      }
    );
    expect(d.preExisting.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(d.newlyFailing).toHaveLength(0);
  });

  it('fail on base, pass on head is resolved', () => {
    const d = diffGuardRuns(
      { base: [scen('a', 'fail')], head: [scen('a', 'pass')], dismissed: none }
    );
    expect(d.resolved.map((s) => s.id)).toEqual(['a']);
    expect(d.newlyFailing).toHaveLength(0);
  });

  it('stale/orphaned head outcomes are pulled aside, never failing', () => {
    const d = diffGuardRuns(
      {
        base: [scen('a', 'pass'), scen('b', 'pass')],
        head: [scen('a', 'stale'), scen('b', 'orphaned')],
        dismissed: none,
      }
    );
    expect(d.stale.map((s) => s.id).sort()).toEqual(['a', 'b']);
    expect(d.newlyFailing).toHaveLength(0);
  });

  it('dismissed claims are excluded BEFORE comparison', () => {
    const dismissed = new Set([dismissedClaimKey('docs/spec.md', 'sec-a', 'claim a')]);
    const d = diffGuardRuns(
      { base: [scen('a', 'pass')], head: [scen('a', 'fail')], dismissed }
    );
    expect(d.excluded.map((s) => s.id)).toEqual(['a']);
    expect(d.newlyFailing).toHaveLength(0);
  });

  it('a null base behaves like an empty base (every head failure is pre-existing)', () => {
    // decideGuardGate short-circuits null base to neutral no-baseline; the diff
    // itself stays total — and with no base counterparts, nothing is attributable
    // to the PR, so nothing lands in newlyFailing.
    const d = diffGuardRuns(
      { base: null, head: [scen('a', 'fail'), scen('b', 'pass')], dismissed: none }
    );
    expect(d.newlyFailing).toHaveLength(0);
    expect(d.preExisting.map((s) => s.id)).toEqual(['a']);
  });
});

describe('decideGuardGate', () => {
  const base = [scen('a', 'pass'), scen('b', 'fail')];

  it('fails (blocking) when the PR newly breaks a scenario', () => {
    const report = okReport([scen('a', 'fail'), scen('b', 'fail')]);
    const d: GuardGateDecision = decideGuardGate(report, base, { blocking: true, dismissed: none });
    expect(d.conclusion).toBe('failure');
    expect(d.diff.newlyFailing.map((s) => s.id)).toEqual(['a']);
    expect(d.diff.preExisting.map((s) => s.id)).toEqual(['b']);
  });

  it('is neutral (advisory) for newly failing scenarios when blocking is off', () => {
    const report = okReport([scen('a', 'fail'), scen('b', 'fail')]);
    const d = decideGuardGate(report, base, { blocking: false, dismissed: none });
    expect(d.conclusion).toBe('neutral');
    expect(d.neutralReason).toBeUndefined();
    expect(d.diff.newlyFailing).toHaveLength(1);
  });

  it('succeeds when only pre-existing failures remain (even blocking)', () => {
    const report = okReport([scen('a', 'pass'), scen('b', 'fail')]);
    const d = decideGuardGate(report, base, { blocking: true, dismissed: none });
    expect(d.conclusion).toBe('success');
    expect(d.diff.preExisting.map((s) => s.id)).toEqual(['b']);
  });

  it('succeeds and reports resolved scenarios', () => {
    const report = okReport([scen('a', 'pass'), scen('b', 'pass')]);
    const d = decideGuardGate(report, base, { blocking: true, dismissed: none });
    expect(d.conclusion).toBe('success');
    expect(d.diff.resolved.map((s) => s.id)).toEqual(['b']);
  });

  it('excludes dismissed claims from the verdict', () => {
    const dismissed = new Set([dismissedClaimKey('docs/spec.md', 'sec-a', 'claim a')]);
    const report = okReport([scen('a', 'fail')]);
    const d = decideGuardGate(report, [scen('a', 'pass')], { blocking: true, dismissed });
    expect(d.conclusion).toBe('success');
    expect(d.diff.excluded).toHaveLength(1);
  });

  it('is neutral (no-baseline) on an ok head with no base run', () => {
    const report = okReport([scen('a', 'fail')]);
    const d = decideGuardGate(report, null, { blocking: true, dismissed: none });
    expect(d.conclusion).toBe('neutral');
    expect(d.neutralReason).toBe('no-baseline');
    expect(d.diff.newlyFailing).toHaveLength(0);
  });

  it('is neutral (no-scenarios) for no-scenarios and no-recipe reports', () => {
    const noScenarios: GuardExecReport = { status: 'no-scenarios', loadErrors: [] };
    const noRecipe: GuardExecReport = { status: 'no-recipe' };
    for (const report of [noScenarios, noRecipe]) {
      const d = decideGuardGate(report, base, { blocking: true, dismissed: none });
      expect(d.conclusion).toBe('neutral');
      expect(d.neutralReason).toBe('no-scenarios');
    }
  });

  it('errors as build-failed when the build breaks', () => {
    const report: GuardExecReport = {
      status: 'build-failed',
      build: { ok: false, command: 'npm run build', exitCode: 1, timedOut: false, output: 'boom' },
      loadErrors: [],
    };
    const d = decideGuardGate(report, base, { blocking: true, dismissed: none });
    expect(d.conclusion).toBe('error');
    expect(d.errorReason).toBe('build-failed');
  });

  it('errors as build-timed-out when the build hit its wall-clock', () => {
    const report: GuardExecReport = {
      status: 'build-failed',
      build: { ok: false, command: 'npm run build', exitCode: null, timedOut: true, output: '' },
      loadErrors: [],
    };
    const d = decideGuardGate(report, base, { blocking: true, dismissed: none });
    expect(d.conclusion).toBe('error');
    expect(d.errorReason).toBe('build-timed-out');
  });

  it('errors as entry-preflight when the built entry cannot start', () => {
    const report: GuardExecReport = {
      status: 'entry-preflight-failed',
      preflight: { ok: false, entry: 'node dist/cli.js', stderr: 'Cannot find module', probes: [] },
      buildCommand: 'npm run build',
      loadErrors: [],
    };
    const d = decideGuardGate(report, base, { blocking: true, dismissed: none });
    expect(d.conclusion).toBe('error');
    expect(d.errorReason).toBe('entry-preflight');
  });

  it('errors as run-timed-out when the overall run wall-clock elapsed', () => {
    const report: GuardExecReport = { status: 'run-timed-out', elapsedMs: 60_000, settled: 3, total: 9 };
    const d = decideGuardGate(report, base, { blocking: true, dismissed: none });
    expect(d.conclusion).toBe('error');
    expect(d.errorReason).toBe('run-timed-out');
  });

  it('errors as aborted when the run was externally cancelled', () => {
    const report: GuardExecReport = { status: 'aborted', phase: 'run' };
    const d = decideGuardGate(report, base, { blocking: true, dismissed: none });
    expect(d.conclusion).toBe('error');
    expect(d.errorReason).toBe('aborted');
  });

  it('errors as infra on an invalid recipe (a broken gate never silently passes)', () => {
    const report: GuardExecReport = { status: 'invalid-recipe', message: 'bad json' };
    const d = decideGuardGate(report, base, { blocking: true, dismissed: none });
    expect(d.conclusion).toBe('error');
    expect(d.errorReason).toBe('infra');
  });
});
