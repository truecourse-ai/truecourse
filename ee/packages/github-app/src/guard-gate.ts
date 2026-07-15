/**
 * Pure guard-gate decision. Diffs the PR head's guard run against the base run
 * and decides the Check conclusion: newly failing scenarios fail (blocking) or
 * inform (advisory); engine-level failures conclude 'error' — a broken gate
 * blocks the merge, it never silently passes; a repo with no committed
 * scenarios is neutral.
 */

import { dismissedClaimKey, type GuardScenarioResult } from '@truecourse/shared';
import type { GuardExecReport } from '@truecourse/guard-runner';

/** 'error' is internal — it RENDERS as GitHub conclusion `failure`, error-styled. */
export type GuardGateConclusion = 'success' | 'failure' | 'neutral' | 'error';

export interface GuardGateInput {
  /** The base run's scenario results; null → no baseline at all. */
  base: GuardScenarioResult[] | null;
  head: GuardScenarioResult[];
  /** `dismissedClaimKey` identities (repo + PR overlay folded by the caller). */
  dismissed: ReadonlySet<string>;
}

export interface GuardGateDiff {
  /** Pass on base, fail/error on head. The ONLY set that fails the Check. */
  newlyFailing: GuardScenarioResult[];
  /** Failing on head without a base PASS to blame the PR for (fail on both sides,
   *  base never executed, or no base counterpart at all) — not this PR's doing. */
  preExisting: GuardScenarioResult[];
  /** Fail on base, pass on head. */
  resolved: GuardScenarioResult[];
  /** Stale/orphaned head bindings → annotations, never a failure. */
  stale: GuardScenarioResult[];
  /** Dismissed-claim exclusions, pulled out before any comparison. */
  excluded: GuardScenarioResult[];
}

export interface GuardGateOptions {
  /** true → newly failing scenarios fail the Check (a required check blocks merge); false → neutral. */
  blocking: boolean;
}

export interface GuardGateDecision {
  conclusion: GuardGateConclusion;
  diff: GuardGateDiff;
  /** Set when the conclusion is neutral for a structural reason. */
  neutralReason?: 'no-scenarios' | 'no-baseline';
  /** Set when the conclusion is 'error' (the run produced no verdict). */
  errorReason?: 'build-failed' | 'entry-preflight' | 'run-timed-out' | 'build-timed-out' | 'aborted' | 'infra';
}

export function emptyGuardGateDiff(): GuardGateDiff {
  return { newlyFailing: [], preExisting: [], resolved: [], stale: [], excluded: [] };
}

function isFailing(outcome: GuardScenarioResult['outcome']): boolean {
  return outcome === 'fail' || outcome === 'error';
}

/**
 * Bucket the head run's scenarios against the base run (matched by scenario id).
 * Dismissed claims are excluded BEFORE comparison; stale/orphaned head bindings
 * are pulled aside (they never executed, so they can neither fail nor resolve).
 * A null base behaves like an empty one — the structural no-baseline neutral is
 * `decideGuardGate`'s call, not the diff's.
 */
export function diffGuardRuns(input: GuardGateInput): GuardGateDiff {
  const baseById = new Map((input.base ?? []).map((s) => [s.id, s]));
  const diff = emptyGuardGateDiff();
  for (const head of input.head) {
    if (input.dismissed.has(dismissedClaimKey(head.binds.doc, head.binds.section, head.title))) {
      diff.excluded.push(head);
      continue;
    }
    if (head.outcome === 'stale' || head.outcome === 'orphaned') {
      diff.stale.push(head);
      continue;
    }
    const base = baseById.get(head.id);
    if (isFailing(head.outcome)) {
      // Acceptance criterion: the Check fails ONLY on scenarios that PASSED on
      // base and fail on head. A base that also failed, never executed
      // (stale/orphaned), or has no counterpart at all (e.g. the stored baseline
      // predates a corpus regeneration that added the scenario) carries no base
      // evidence this PR broke it: pre-existing, never the PR's red.
      if (base?.outcome === 'pass') diff.newlyFailing.push(head);
      else diff.preExisting.push(head);
    } else if (base && isFailing(base.outcome)) {
      diff.resolved.push(head);
    }
  }
  return diff;
}

/**
 * Map a guard run report to the Check decision. Only an 'ok' report is diffed;
 * every engine-level failure is an 'error' conclusion (rendered as a FAILURE
 * Check — decision: a broken gate blocks, never neutral), and a corpus that
 * cannot run at all (no recipe / no scenarios) is neutral.
 */
export function decideGuardGate(
  report: GuardExecReport,
  base: GuardScenarioResult[] | null,
  opts: GuardGateOptions & { dismissed: ReadonlySet<string> },
): GuardGateDecision {
  switch (report.status) {
    case 'no-recipe':
    case 'no-scenarios':
      return { conclusion: 'neutral', diff: emptyGuardGateDiff(), neutralReason: 'no-scenarios' };
    // A committed-but-unparseable recipe is a gate breakage, not an empty corpus:
    // concluding neutral would let a PR that corrupts recipe.json pass silently.
    case 'invalid-recipe':
      return { conclusion: 'error', diff: emptyGuardGateDiff(), errorReason: 'infra' };
    case 'build-failed':
      return {
        conclusion: 'error',
        diff: emptyGuardGateDiff(),
        errorReason: report.build.timedOut ? 'build-timed-out' : 'build-failed',
      };
    case 'entry-preflight-failed':
      return { conclusion: 'error', diff: emptyGuardGateDiff(), errorReason: 'entry-preflight' };
    case 'run-timed-out':
      return { conclusion: 'error', diff: emptyGuardGateDiff(), errorReason: 'run-timed-out' };
    case 'aborted':
      return { conclusion: 'error', diff: emptyGuardGateDiff(), errorReason: 'aborted' };
    case 'ok': {
      // No base run to diff against (e.g. guard is being bootstrapped before any
      // default-branch baseline exists) — don't fail; just inform.
      if (base === null) {
        return { conclusion: 'neutral', diff: emptyGuardGateDiff(), neutralReason: 'no-baseline' };
      }
      const diff = diffGuardRuns({ base, head: report.latest.scenarios, dismissed: opts.dismissed });
      let conclusion: GuardGateConclusion;
      if (diff.newlyFailing.length === 0) conclusion = 'success';
      else conclusion = opts.blocking ? 'failure' : 'neutral';
      return { conclusion, diff };
    }
  }
}
