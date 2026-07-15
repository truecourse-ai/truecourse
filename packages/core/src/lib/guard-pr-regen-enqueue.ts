/**
 * Injectable seam: enqueue a hosted PR-HEAD guard regenerate for `(repoKey, pr)`.
 *
 * The PR analog of `guard-generate-enqueue`: a PR-scoped dismissal that
 * suppresses the PR's LAST active finding should regenerate the PR head's
 * scenarios honoring the dismissals overlay, so the suppressed claim stops
 * surfacing on that PR. The dashboard dismiss route hands the repo off through
 * this seam without importing any EE package (it's a sibling adapter over core —
 * same rule as `guard-generate-enqueue` / `guard-gate-pending`).
 *
 * The enterprise edition resolves installation / workspace org from its stored
 * gate records and the live PR (base/head/fork) from GitHub, then enqueues the
 * same durable `guard.spec-regen` job the PR's spec-change checkbox uses — with
 * no checkbox comment to settle. Unset (OSS — PR decision scopes don't exist
 * there, or EE without the worker) → the caller runs nothing. Best-effort: a
 * failed enqueue never fails the decision save.
 */

/** Enqueue a hosted PR-head guard regenerate. Best-effort — resolves silently. */
export type GuardPrRegenEnqueue = (repoKey: string, pr: number) => Promise<void>;

let enqueue: GuardPrRegenEnqueue | null = null;

/** Install the EE enqueue (or clear it with null). Called once at boot. */
export function setGuardPrRegenEnqueue(fn: GuardPrRegenEnqueue | null): void {
  enqueue = fn;
}

/** The active PR-regen enqueue, or null when none is registered (OSS/tests). */
export function getGuardPrRegenEnqueue(): GuardPrRegenEnqueue | null {
  return enqueue;
}
