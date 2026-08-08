/**
 * EE lens model — the pure (no React) description of the EE repo console's
 * top-level lenses and their curated tab bars, extracted from RepoPage so the
 * URL-coherence logic is testable on its own.
 *
 * Lenses:
 *   - `codequality`  — analysis (Analytics · Violations · Settings)
 *   - `guard`        — spec coverage (Coverage · Flows · Journeys · Runs)
 */

/** EE Code Quality (analysis) tab bar: Analytics · Violations, then the common
 *  Settings. The analytics/violations tabs are EE-only (gated on `workspace`);
 *  `settings` is sourced from the drift section (section-neutral, repo-wide
 *  config). The Architecture graph (and Flows/Files/Databases/History) are not
 *  shown in hosted — violations link straight to the code on GitHub instead. */
export const EE_ANALYSIS_TAB_ORDER = ['analytics', 'violations', 'settings'];

/** EE Guard tab bar: the full OSS set — Coverage (default) · Flows · Journeys ·
 *  Runs. (Flows carries the tests: one flow, one test, one page.) */
export const EE_GUARD_TAB_ORDER = ['coverage', 'guardflows', 'journeys', 'guarddrifts'];

/** EE relabels for Code Quality tabs (none currently — registry labels stand). */
export const EE_ANALYSIS_TAB_LABELS: Record<string, string> = {};

/** The curated tab order for an EE lens (unknown sections fall back to analysis). */
export function eeLensTabOrder(section: string): string[] {
  if (section === 'guard') return EE_GUARD_TAB_ORDER;
  return EE_ANALYSIS_TAB_ORDER;
}

/** The tab an EE lens lands on: its FIRST curated tab (not the OSS registry
 *  default). */
export function eeDefaultTab(section: string): string {
  return eeLensTabOrder(section)[0];
}

/** Explicit `?section` values recognized as EE lenses. */
const EE_LENSES = ['codequality', 'guard'];

/**
 * Decide whether the EE console's URL needs a coherence rewrite.
 *
 * Keeps EE in a coherent state: one of the lenses above, each with its own
 * curated tab set. Keyed off the EXPLICIT ?section param so the default (no
 * param, or an unknown value) lands on Code Quality.
 *
 * Returns the `{section, tab}` the URL should be rewritten to, or `null` when
 * the current state is already coherent (the active `leftTab` is a member of
 * the explicit lens's curated order and isn't Settings while a PR is scoped).
 * On rewrite, a `?tab` that is valid for the target order is kept; only
 * missing/invalid/settings-in-PR tabs are replaced with the lens default.
 */
export function resolveEeLens({
  searchParams,
  prNumber,
  leftTab,
}: {
  searchParams: URLSearchParams;
  prNumber: number | null;
  leftTab: string | null;
}): { section: string; tab: string } | null {
  const sectionParam = searchParams.get('section');
  const sectionExplicit = sectionParam != null && EE_LENSES.includes(sectionParam);
  const section = sectionExplicit ? sectionParam : 'codequality';
  const order = eeLensTabOrder(section);
  // Settings is common to the lenses but repo-wide — hidden while viewing a PR.
  const settingsInPr = prNumber != null && leftTab === 'settings';
  if (sectionExplicit && leftTab && order.includes(leftTab) && !settingsInPr) {
    return null;
  }
  const t = searchParams.get('tab');
  const tab =
    t && order.includes(t) && !(prNumber != null && t === 'settings')
      ? t
      : eeDefaultTab(section);
  return { section, tab };
}
