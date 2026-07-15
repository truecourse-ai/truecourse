/**
 * Injectable seam: enqueue a hosted guard-scenario GENERATE for a repo.
 *
 * A repo-scope spec decision that brings the open-conflict count to 0 clears the
 * block that stopped an earlier generate — the guard store still holds an
 * `open-conflicts` report and no scenarios. The dashboard spec routes hand that
 * repo off through this seam so scenarios finally get authored, without importing
 * any EE package (it's a sibling adapter over core — same rule as
 * `background-tasks` / `guard-gate-pending` / `repo-doc-reader`).
 *
 * Keyed by `repoKey` alone: the enterprise edition resolves installation / default
 * branch / baseline commit / workspace org from its stored gate records (the same
 * resolution the manual "Generate" route does). Unset (OSS, or EE without the
 * worker) → the caller runs nothing; OSS regenerates via the manual Generate step.
 * Best-effort: a failed enqueue never fails the decision save.
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
