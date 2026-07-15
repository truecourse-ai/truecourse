/**
 * Injectable seam: look up an in-flight hosted guard gate for a PR head.
 *
 * The PR-scoped `/guard/latest?ref=<headSha>` route uses this to label its empty
 * state "queued/running" when the gate hasn't produced a run at that commit yet.
 * Lives in core (like `repo-doc-reader`) so the OSS dashboard route can read it
 * without importing any EE package — the enterprise edition registers the real
 * lookup at boot (closing over its jobs store). Unset (OSS, or EE without the
 * worker) → the route reports no pending gate.
 */

import type { GuardGatePending } from '@truecourse/shared';

/** Resolve the active `guard.gate` job for `(repoKey, headSha)`, or null when none. */
export type GuardGatePendingLookup = (
  repoKey: string,
  headSha: string,
) => Promise<GuardGatePending | null>;

let lookup: GuardGatePendingLookup | null = null;

/** Install the EE lookup (or clear it with null). Called once at boot. */
export function setGuardGatePendingLookup(fn: GuardGatePendingLookup | null): void {
  lookup = fn;
}

/** The active guard-gate-pending lookup, or null when none is registered (OSS). */
export function getGuardGatePendingLookup(): GuardGatePendingLookup | null {
  return lookup;
}

/**
 * The distinct head SHAs the guard gate has run for `(repoKey, prNumber)`,
 * newest-first — the PR run timeline's spine. Same seam idiom as the pending
 * lookup: EE registers it at boot (closing over its gate store); unset (OSS) →
 * `readGuardHistoryForPr` reports no runs.
 */
export type GuardGateHeadsLookup = (repoKey: string, prNumber: number) => Promise<string[]>;

let headsLookup: GuardGateHeadsLookup | null = null;

/** Install the EE heads lookup (or clear it with null). Called once at boot. */
export function setGuardGateHeadsLookup(fn: GuardGateHeadsLookup | null): void {
  headsLookup = fn;
}

/** The active guard-gate-heads lookup, or null when none is registered (OSS). */
export function getGuardGateHeadsLookup(): GuardGateHeadsLookup | null {
  return headsLookup;
}
