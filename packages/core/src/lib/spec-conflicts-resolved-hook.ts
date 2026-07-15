/**
 * Injectable seam: dispatch a hosted repo baseline SCAN after a spec decision
 * clears the last open conflict.
 *
 * A repo-scope spec decision that brings the open-conflict count to 0 leaves the
 * curated corpus unambiguous. The hosted repo then re-scans its baseline (force —
 * the commit hasn't moved) so the corpus re-curates in the store, and the
 * conflict-free scan's settle chains scenario generation. The dashboard spec routes
 * hand the repo off through this seam without importing any EE package (a sibling
 * adapter over core — same rule as `guard-generate-enqueue` / `background-tasks` /
 * `repo-doc-reader`).
 *
 * Keyed by `repoKey` alone: the enterprise edition resolves installation / default
 * branch / baseline commit / workspace org from its stored gate records. Unset
 * (OSS, or EE without the worker) → the caller runs nothing; OSS re-scans via its
 * own manual Scan step. Best-effort: a failed enqueue never fails the decision save.
 */

/** Enqueue a hosted repo baseline scan for `repoKey`. Best-effort — resolves silently. */
export type SpecConflictsResolvedHook = (repoKey: string) => Promise<void>;

let hook: SpecConflictsResolvedHook | null = null;

/** Install the EE dispatch (or clear it with null). Called once at boot. */
export function setSpecConflictsResolvedHook(fn: SpecConflictsResolvedHook | null): void {
  hook = fn;
}

/** The active dispatch, or null when none is registered (OSS/tests). */
export function getSpecConflictsResolvedHook(): SpecConflictsResolvedHook | null {
  return hook;
}
