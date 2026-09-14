/**
 * Injectable seam: enqueue a hosted guard-scenario GENERATE for a repo.
 *
 * A decision that brings a repository's open-conflict count to 0 clears the
 * block that stopped an earlier generate — the guard store still holds an
 * `open-conflicts` report and no scenarios. The decision routes hand that repo
 * off through this seam so scenarios finally get authored (a sibling adapter
 * over core — same rule as `guard-gate-pending` / `repo-doc-reader`).
 *
 * Keyed by `repoKey` alone: the job resolves everything else it needs from the
 * repository's own rows. Unset (tests, a process with no worker) → the caller
 * runs nothing. Best-effort: a failed enqueue never fails the decision save.
 */

/** Enqueue a hosted guard generate for `repoKey`. Best-effort — resolves silently. */
export type GuardGenerateEnqueue = (repoKey: string) => Promise<void>;

let enqueue: GuardGenerateEnqueue | null = null;

/** Install the EE enqueue (or clear it with null). Called once at boot. */
export function setGuardGenerateEnqueue(fn: GuardGenerateEnqueue | null): void {
  enqueue = fn;
}

/** The active guard-generate enqueue, or null when none is registered (OSS/tests). */
export function getGuardGenerateEnqueue(): GuardGenerateEnqueue | null {
  return enqueue;
}
